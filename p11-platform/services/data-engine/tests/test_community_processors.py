"""Host format tests; real OCR/media and native sandbox tests run in the worker image."""
import hashlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from community_brain.processors import process_original, MIMES


def office_file(parts):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        for name, text in parts.items(): archive.writestr(name, text)
    return out.getvalue()


class ProcessorTests(unittest.TestCase):
    def run_file(self, data, ext, expected=None):
        with tempfile.TemporaryDirectory() as directory:
            receipt = process_original(data, 'original.'+ext, MIMES[ext], expected or hashlib.sha256(data).hexdigest(), Path(directory))
            for item in receipt['artifacts']:
                self.assertEqual(hashlib.sha256((Path(directory)/item['name']).read_bytes()).hexdigest(), item['contentHash'])
            return receipt

    def test_text_and_csv_preserve_zero_and_empty(self):
        for ext in ['txt', 'md']:
            self.assertEqual(self.run_file(b'Community A\nNo pool', ext)['text'], 'Community A\nNo pool')
        r = self.run_file(b'plan,rent,available\nA,,0\nB,1500,2', 'csv')
        self.assertTrue(r['complete'])
        self.assertEqual(r['pageDetails'][0]['rows'][1], ['A', '', '0'])
        self.assertFalse(r['pageDetails'][0]['typesInferred'])

    def test_wrong_hash_and_mime_never_extract(self):
        self.assertEqual(self.run_file(b'abc', 'txt', '0'*64)['errorCode'], 'bytes_changed')
        self.assertFalse(self.run_file(b'<html/>', 'png')['complete'])
        self.assertFalse(self.run_file(b'\0untrusted', 'txt')['complete'])

    def test_raster_formats_and_animation(self):
        for ext, fmt in [('jpg','JPEG'),('png','PNG'),('webp','WEBP'),('gif','GIF')]:
            out=io.BytesIO(); Image.new('RGB',(160,120),'white').save(out,format=fmt)
            r=self.run_file(out.getvalue(), ext)
            self.assertTrue(r['complete'], r)
            self.assertTrue(r['retrievalOnly'])
            self.assertEqual([a['kind'] for a in r['artifacts']], ['page','preview'])
        out=io.BytesIO();Image.new('RGB',(50,50),'red').save(out,format='GIF',save_all=True,append_images=[Image.new('RGB',(50,50),'blue')],duration=100)
        self.assertIn('first of 2', ' '.join(self.run_file(out.getvalue(),'gif')['limitations']))

    def test_office_text_and_exact_cell_provenance(self):
        r=self.run_file(office_file({'word/document.xml':'<document><p><t>Community A</t></p><tbl><tr><tc><p><t>2 beds</t></p></tc></tr></tbl></document>'}), 'docx')
        self.assertEqual(r['text'], 'Community A\n2 beds')
        r=self.run_file(office_file({'ppt/slides/slide1.xml':'<slide><t>Brand blue</t></slide>','ppt/slides/slide2.xml':'<slide><t>Exact logo</t></slide>'}), 'pptx')
        self.assertEqual(r['pages'], ['Brand blue','Exact logo'])
        r=self.run_file(office_file({'xl/workbook.xml':'<workbook/>','xl/worksheets/sheet1.xml':'<worksheet><c r="A1"><v>0</v></c><c r="B1"><f>WEBSERVICE(&quot;https://example.invalid&quot;)</f></c></worksheet>'}), 'xlsx')
        cells=r['pageDetails'][0]['cells']
        self.assertEqual(cells[0]['value'], '0');self.assertIsNone(cells[1]['value']);self.assertIn('WEBSERVICE',cells[1]['formula'])

    def test_unsafe_archives_and_svg_fail_closed(self):
        for parts in [{'../word/document.xml':'x'},{'word/vbaProject.bin':'x'},{'word/document.xml':'<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x>&a;</x>'}]:
            self.assertFalse(self.run_file(office_file(parts),'docx')['complete'])
        for xml in ['<svg><script>alert(1)</script></svg>', '<svg onload="x"/>', '<svg><image href="https://example.invalid/a"/></svg>']:
            self.assertFalse(self.run_file(xml.encode(),'svg')['complete'])
        self.assertTrue(self.run_file(b'<svg xmlns="http://www.w3.org/2000/svg"><title>Logo A</title><path d="M0 0 L10 10"/></svg>','svg')['complete'])

    def test_real_fonts_and_transparent_logo(self):
        from fontTools.fontBuilder import FontBuilder
        from fontTools.pens.ttGlyphPen import TTGlyphPen
        from fontTools.pens.t2CharStringPen import T2CharStringPen
        for ext in ['ttf', 'woff', 'woff2', 'otf']:
            builder=FontBuilder(1000,isTTF=ext!='otf')
            builder.setupGlyphOrder(['.notdef','A']);builder.setupCharacterMap({65:'A'})
            glyphs={}
            for name in ['.notdef','A']:
                pen=T2CharStringPen(600,None) if ext=='otf' else TTGlyphPen(None)
                pen.moveTo((50,0));pen.lineTo((300,700));pen.lineTo((550,0));pen.closePath()
                glyphs[name]=pen.getCharString() if ext=='otf' else pen.glyph()
            if ext=='otf':builder.setupCFF('SyntheticFixture',{},glyphs,{})
            else:builder.setupGlyf(glyphs)
            builder.setupHorizontalMetrics({name:(600,0)for name in glyphs});builder.setupHorizontalHeader(ascent=800,descent=-200)
            builder.setupNameTable({'familyName':'SyntheticFixture','styleName':'Regular','psName':'SyntheticFixture-Regular','fullName':'SyntheticFixture Regular'})
            builder.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200);builder.setupPost();builder.setupMaxp()
            builder.font.flavor=ext if ext in ['woff','woff2']else None
            out=io.BytesIO();builder.font.save(out)
            result=self.run_file(out.getvalue(),ext)
            self.assertTrue(result['complete'],result)
            self.assertTrue(result['pageDetails'][0]['names'])
            self.assertFalse(self.run_file(out.getvalue()[:16],ext)['complete'])
        out=io.BytesIO();Image.new('RGBA',(20,20),(255,0,0,0)).save(out,format='PNG')
        with tempfile.TemporaryDirectory()as directory:
            data=out.getvalue();r=process_original(data,'logo.png',MIMES['png'],hashlib.sha256(data).hexdigest(),Path(directory))
            with Image.open(Path(directory)/r['artifacts'][0]['name'])as exact:self.assertEqual(exact.getpixel((0,0))[3],0)

    @unittest.skipUnless(sys.platform=='linux','Full parser subprocess is qualified in Linux')
    def test_actual_parser_subprocess_with_resource_and_network_sandbox(self):
        from community_brain.worker import parse_in_process
        data=b'Community A original. This is candidate text, not an approved claim.'
        file={'input':{'fileName':'policy.txt','mimeType':'text/plain','byteHash':hashlib.sha256(data).hexdigest()}}
        with tempfile.TemporaryDirectory()as directory:
            receipt=parse_in_process(data,file,Path(directory))
            self.assertTrue(receipt['complete'],receipt)
            self.assertEqual(receipt['text'],data.decode())

    @unittest.skipUnless(shutil.which('tesseract'), 'Real OCR is qualified in the worker image')
    def test_scanned_multipage_floorplan_pdf_exact_pages(self):
        image=Image.new('RGB',(1200,700),'white');draw=ImageDraw.Draw(image)
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',48)
        draw.text((50,100),'Community A - Plan 101 - 2 bedrooms',fill='black',font=font)
        second=Image.new('RGB',(1200,700),'white');ImageDraw.Draw(second).text((50,100),'Community A - Plan 202 - 3 bedrooms',fill='black',font=font)
        out=io.BytesIO();image.save(out,format='PDF',save_all=True,append_images=[second])
        r=self.run_file(out.getvalue(),'pdf')
        self.assertTrue(r['complete'],r);self.assertEqual(r['totalPages'],2)
        self.assertIn('101',r['pages'][0]);self.assertIn('202',r['pages'][1])
        self.assertEqual([a['page']for a in r['artifacts']],[1,2]);self.assertTrue(r['pageDetails'][0]['regions'])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'Real video is qualified in the worker image')
    def test_mp4_and_webm_are_retrieval_only(self):
        with tempfile.TemporaryDirectory() as directory:
            for ext,codec in [('mp4','libx264'),('webm','libvpx-vp9')]:
                path=Path(directory)/('sample.'+ext)
                subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=320x240:d=0.2','-c:v',codec,str(path)],check=True)
                r=self.run_file(path.read_bytes(),ext)
                self.assertTrue(r['complete'],r);self.assertTrue(r['retrievalOnly']);self.assertEqual(r['text'],'');self.assertEqual(r['artifacts'][0]['kind'],'poster')

    @unittest.skipUnless(sys.platform=='linux','Native seccomp requires Linux')
    def test_native_socket_calls_are_blocked(self):
        code='from community_brain.parser_process import restrict_parser; import subprocess; restrict_parser(); r=subprocess.run(["python","-c","import socket; socket.socket()"],capture_output=True); assert r.returncode != 0 and b"Operation not permitted" in r.stderr'
        result=subprocess.run([sys.executable,'-c',code],capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__': unittest.main()
