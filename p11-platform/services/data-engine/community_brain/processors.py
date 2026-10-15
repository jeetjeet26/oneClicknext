"""Bounded, offline extraction. Text is evidence for review, never an automatic fact update."""
from __future__ import annotations

from contextlib import closing
import csv
import hashlib
import io
import json
import re
import shutil
import subprocess
import warnings
import zipfile
from pathlib import Path, PurePosixPath
from defusedxml import ElementTree as XML
from defusedxml.common import DefusedXmlException

RECIPE = 'community-file-v1'
MAX_PAGES = 100
MAX_TEXT = 1024 * 1024
MAX_PIXELS = 40_000_000
MIMES = {
    'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv', 'pdf': 'application/pdf',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp', 'gif': 'image/gif', 'svg': 'image/svg+xml',
    'woff': 'font/woff', 'woff2': 'font/woff2', 'ttf': 'font/ttf', 'otf': 'font/otf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'mp4': 'video/mp4', 'webm': 'video/webm',
}


class ProcessingError(ValueError):
    pass


def max_bytes(extension: str) -> int:
    size = 100 if extension in {'mp4', 'webm'} else 25 if extension in {'pdf', 'docx', 'pptx', 'xlsx'} else 20 if extension in {'png', 'jpg', 'jpeg', 'webp', 'gif'} else 5 if extension in {'woff', 'woff2', 'ttf', 'otf'} else 1
    return size * 1024 * 1024


def artifact(output: Path, name: str, data: bytes, mime: str, page=1, kind='preview', metadata=None) -> dict:
    if len(data) > 20_000_000 or not re.fullmatch(r'[a-z0-9._-]+', name):
        raise ProcessingError('rendition_limit')
    (output / name).write_bytes(data)
    return {'name': name, 'contentHash': hashlib.sha256(data).hexdigest(), 'byteSize': len(data), 'mimeType': mime, 'page': page, 'kind': kind, 'metadata': metadata or {}}


def image_bytes(image, format='PNG') -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=format)
    return buffer.getvalue()


def ocr_image(path: Path) -> tuple[str, list[dict]]:
    binary = shutil.which('tesseract')
    if not binary:
        raise ProcessingError('ocr_unavailable')
    # TSV preserves word boxes and confidence. No shell and no remote image loading.
    result = subprocess.run([binary, str(path), 'stdout', '-l', 'eng', 'tsv'], capture_output=True, timeout=40, check=False)
    if result.returncode:
        raise ProcessingError('ocr_failed')
    regions, lines = [], {}
    for row in csv.DictReader(io.StringIO(result.stdout.decode('utf-8', 'strict')), delimiter='\t'):
        text = row.get('text', '').strip()
        if not text:
            continue
        key = tuple(row[name] for name in ('block_num', 'par_num', 'line_num'))
        lines.setdefault(key, []).append(text)
        regions.append({'text': text, 'confidence': float(row['conf']) / 100,
                        'bbox': [int(row[name]) for name in ('left', 'top', 'width', 'height')], 'coordinates': 'pixels'})
    return '\n'.join(' '.join(words) for words in lines.values()), regions


def pdf(data: bytes, output: Path) -> tuple[list[str], list[dict], list[dict], list[str]]:
    if not data.startswith(b'%PDF-'):
        raise ProcessingError('mime_mismatch')
    import pypdfium2 as pdfium
    pages, details, artifacts, limitations = [], [], [], []
    try:
        document = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as error:
        raise ProcessingError('encrypted_pdf' if error.err_code == 4 else 'corrupt_pdf') from error
    with document:
        if not 1 <= len(document) <= MAX_PAGES:
            raise ProcessingError('page_limit')
        for index in range(len(document)):
            with closing(document[index]) as page:
                width, height = page.get_size()
                if width <= 0 or height <= 0 or width * height * 4 > MAX_PIXELS:
                    raise ProcessingError('pixel_limit')
                with closing(page.get_textpage()) as text_page:
                    native = text_page.get_text_bounded().strip()
                    regions = [{'text': native, 'bbox': [0, 0, width, height], 'coordinates': 'pdf_points', 'method': 'native'}] if native else []
                bitmap = page.render(scale=2)
                try:
                    preview = bitmap.to_pil().convert('RGB')
                    name = f'page-{index + 1}.png'
                    artifacts.append(artifact(output, name, image_bytes(preview), 'image/png', index + 1, 'page', {'width': preview.width, 'height': preview.height}))
                finally:
                    bitmap.close()
                has_images = any(page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE]))
                method, text = 'native', native
                if not native or has_images:
                    recognized, ocr_regions = ocr_image(output / name)
                    regions.extend({**region, 'method': 'ocr'} for region in ocr_regions)
                    method = 'mixed' if native else 'ocr'
                    # Retain native text verbatim and identify OCR additions; never replace numeric text silently.
                    additions = [line for line in recognized.splitlines() if line.strip() and line.strip() not in native]
                    text = native + ('\n' if native and additions else '') + '\n'.join(additions)
                    limitations.append('OCR-derived words and dimensions require human review against the exact page.')
                pages.append(text)
                details.append({'page': index + 1, 'method': method, 'regions': regions, 'width': width, 'height': height})
    return pages, details, artifacts, sorted(set(limitations))


def raster(data: bytes, extension: str, output: Path):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    expected = 'JPEG' if extension in {'jpg', 'jpeg'} else extension.upper()
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as original:
            if original.format != expected or original.width * original.height > MAX_PIXELS:
                raise ProcessingError('mime_mismatch_or_pixel_limit')
            frames = getattr(original, 'n_frames', 1)
            if frames > 500:
                raise ProcessingError('frame_limit')
            original.seek(0)
            display = ImageOps.exif_transpose(original).convert('RGBA' if 'A' in original.getbands() or 'transparency' in original.info else 'RGB')
            # Exact oriented pixels are retained for a reviewed floorplan binding; thumbnails are separate.
            exact = artifact(output, 'page-1.png', image_bytes(display), 'image/png', kind='page', metadata={'width': display.width, 'height': display.height, 'frame': 0})
            preview = display.copy(); preview.thumbnail((1600, 1600))
            small = artifact(output, 'preview-1.webp', image_bytes(preview, 'WEBP'), 'image/webp', metadata={'width': preview.width, 'height': preview.height})
    limitations = ['The original remains authoritative; OCR does not establish amenities or dimensions.']
    if frames > 1:
        limitations.append(f'Preview shows the first of {frames} frames. The full animation is retained in the original.')
    try:
        text, regions = ocr_image(output / 'page-1.png')
    except ProcessingError as error:
        if str(error) != 'ocr_unavailable':
            raise
        text, regions = '', []
        limitations.append('OCR is unavailable; exact image retrieval remains available.')
    return [text], [{'page': 1, 'method': 'ocr', 'regions': regions, 'frames': frames}], [exact, small], limitations


def safe_xml(data: bytes):
    if len(data) > 16 * 1024 * 1024:
        raise ProcessingError('xml_limit')
    return XML.fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)


def safe_office(data: bytes) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise ProcessingError('corrupt_office_file') from error
    info = archive.infolist()
    if len(info) > 2000 or sum(item.file_size for item in info) > 100 * 1024 * 1024:
        archive.close(); raise ProcessingError('archive_expansion_limit')
    for item in info:
        path = PurePosixPath(item.filename)
        if path.is_absolute() or '..' in path.parts or '\\' in item.filename or item.flag_bits & 1:
            archive.close(); raise ProcessingError('unsafe_or_encrypted_archive')
        if item.file_size > 32 * 1024 * 1024 or item.file_size / max(1, item.compress_size) > 200:
            archive.close(); raise ProcessingError('archive_expansion_limit')
        if 'vbaproject' in item.filename.lower() or 'activex' in item.filename.lower():
            archive.close(); raise ProcessingError('active_office_content')
    if '[Content_Types].xml' not in archive.namelist():
        archive.close(); raise ProcessingError('invalid_office_container')
    return archive


def local_name(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def office(data: bytes, extension: str, output: Path):
    pages, details, artifacts = [], [], []
    with safe_office(data) as archive:
        names = archive.namelist()
        if extension == 'docx':
            if 'word/document.xml' not in names:
                raise ProcessingError('mime_mismatch')
            root = safe_xml(archive.read('word/document.xml'))
            paragraphs = [''.join(node.itertext()) for node in root.iter() if local_name(node.tag) == 'p']
            pages = ['\n'.join(paragraphs)]
            details = [{'page': 1, 'method': 'office_xml', 'locator': 'word/document.xml', 'paragraphCount': len(paragraphs)}]
        elif extension == 'pptx':
            slides = sorted((name for name in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', name)), key=lambda value: int(re.search(r'(\d+)\.xml', value).group(1)))
            if not 1 <= len(slides) <= MAX_PAGES:
                raise ProcessingError('slide_limit_or_mime_mismatch')
            for index, name in enumerate(slides):
                root = safe_xml(archive.read(name))
                pages.append('\n'.join(node.text or '' for node in root.iter() if local_name(node.tag) == 't'))
                details.append({'page': index + 1, 'method': 'office_xml', 'locator': name})
        else:
            if 'xl/workbook.xml' not in names:
                raise ProcessingError('mime_mismatch')
            shared = []
            if 'xl/sharedStrings.xml' in names:
                shared = [''.join(node.itertext()) for node in safe_xml(archive.read('xl/sharedStrings.xml')) if local_name(node.tag) == 'si']
            workbook=safe_xml(archive.read('xl/workbook.xml'))
            mapping={r.attrib.get('Id'):r.attrib.get('Target','') for r in safe_xml(archive.read('xl/_rels/workbook.xml.rels'))} if 'xl/_rels/workbook.xml.rels'in names else {}
            sheet_names={}
            for node in workbook.iter():
                if local_name(node.tag)=='sheet':
                    relation=next((v for k,v in node.attrib.items()if local_name(k)=='id'),None)
                    target=mapping.get(relation,'').lstrip('/')
                    locator=target if target.startswith('xl/')else 'xl/'+target
                    sheet_names[locator]=node.attrib.get('name')
            sheets = sorted(name for name in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', name))
            if not 1 <= len(sheets) <= MAX_PAGES:
                raise ProcessingError('sheet_limit')
            for index, name in enumerate(sheets):
                root, cells = safe_xml(archive.read(name)), []
                for cell in root.iter():
                    if local_name(cell.tag) != 'c':
                        continue
                    value = next((node.text for node in cell if local_name(node.tag) == 'v'), None)
                    formula = next((node.text for node in cell if local_name(node.tag) == 'f'), None)
                    kind = cell.attrib.get('t', 'number')
                    if kind == 's' and value is not None:
                        value = shared[int(value)]
                    if kind == 'inlineStr':
                        value = ''.join(node.text or '' for node in cell.iter() if local_name(node.tag) == 't')
                    cells.append({'cell': cell.attrib.get('r'), 'type': kind, 'value': value, 'formula': formula, 'style': cell.attrib.get('s')})
                    if len(cells) > 50_000:
                        raise ProcessingError('cell_limit')
                pages.append('\n'.join(f"{cell['cell']}: {json.dumps(cell['value'], ensure_ascii=False)}" for cell in cells))
                details.append({'page': index + 1, 'method': 'office_xml', 'locator': name, 'sheetName': sheet_names.get(name), 'cells': cells})
        relationships = []
        for name in names:
            if name.endswith('.rels'):
                for rel in safe_xml(archive.read(name)):
                    relationships.append({'part': name, 'id': rel.attrib.get('Id'), 'target': rel.attrib.get('Target'), 'external': rel.attrib.get('TargetMode') == 'External'})
        if details:
            details[0]['relationships'] = relationships
        # Embedded media retains its ZIP part relationship and exact source hash.
        # It is a review candidate, never an approved community photograph by import.
        media=[name for name in names if re.fullmatch(r'(word|ppt|xl)/media/[^/]+\.(png|jpe?g|gif|webp)',name,re.I)]
        if len(media)>50:raise ProcessingError('embedded_media_limit')
        from PIL import Image,ImageOps
        for index,name in enumerate(media):
            original=archive.read(name)
            with Image.open(io.BytesIO(original))as image:
                if image.width*image.height>MAX_PIXELS:raise ProcessingError('pixel_limit')
                image.seek(0)
                pixels=ImageOps.exif_transpose(image).convert('RGBA'if 'A'in image.getbands()else'RGB')
                artifacts.append(artifact(output,f'embedded-{index+1}.png',image_bytes(pixels),'image/png',index+1,'embedded',{'sourcePart':name,'sourceHash':hashlib.sha256(original).hexdigest(),'relationships':[r for r in relationships if r['target']and r['target'].split('/')[-1]==name.split('/')[-1]]}))
    return pages, details, artifacts, ['Office layout and pagination may differ from rendered pages. Formulas, macros and external references are never executed. Spreadsheet dates and units require typed review; cached formula values may be absent.']


def svg(data: bytes, output: Path):
    root = safe_xml(data)
    if local_name(root.tag) != 'svg':
        raise ProcessingError('mime_mismatch')
    denied = {'script', 'foreignObject', 'iframe', 'audio', 'video', 'use', 'image', 'style', 'animate', 'set'}
    for node in root.iter():
        if local_name(node.tag) in denied:
            raise ProcessingError('active_svg_content')
        for key, value in node.attrib.items():
            if local_name(key).lower().startswith('on') or local_name(key) in {'href', 'src'} or re.search(r'url\s*\(|@import|javascript:', value, re.I):
                raise ProcessingError('active_svg_content')
    clean = XML.tostring(root, encoding='utf-8')
    text = '\n'.join(node.text or '' for node in root.iter() if local_name(node.tag) in {'text', 'title', 'desc'})
    return [text], [{'page': 1, 'method': 'validated_svg'}], [artifact(output, 'sanitized.svg', clean, 'image/svg+xml', kind='sanitized')], ['External references and active SVG features are unsupported. The original is retained separately.']


def video(data: bytes, extension: str, output: Path):
    if (extension == 'mp4' and data[4:8] != b'ftyp') or (extension == 'webm' and not data.startswith(bytes.fromhex('1a45dfa3'))):
        raise ProcessingError('mime_mismatch')
    probe, ffmpeg = shutil.which('ffprobe'), shutil.which('ffmpeg')
    if not probe or not ffmpeg:
        raise ProcessingError('video_processor_unavailable')
    original = output / f'input.{extension}'; original.write_bytes(data)
    try:
        result = subprocess.run([probe, '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', str(original)], capture_output=True, timeout=20, check=True)
        metadata = json.loads(result.stdout)
        streams = metadata.get('streams', [])
        if not any(stream.get('codec_type') == 'video' for stream in streams):
            raise ProcessingError('video_stream_missing')
        if any(int(stream.get('width', 0)) * int(stream.get('height', 0)) > MAX_PIXELS for stream in streams):
            raise ProcessingError('pixel_limit')
        poster = output / 'poster.png'
        subprocess.run([ffmpeg, '-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', str(original), '-frames:v', '1', '-vf', 'scale=1600:-2:force_original_aspect_ratio=decrease', str(poster)], capture_output=True, timeout=30, check=True)
        rendered = artifact(output, 'poster.png', poster.read_bytes(), 'image/png', kind='poster')
        return [''], [{'page': 1, 'method': 'ffprobe', 'metadata': metadata}], [rendered], ['The original video is retained. A poster is available; no transcript or claim about its content is inferred.']
    finally:
        original.unlink(missing_ok=True)


def process_original(data: bytes, filename: str, mime: str, expected_hash: str, output: Path) -> dict:
    base = {'recipe': RECIPE, 'fileHash': expected_hash, 'complete': False, 'totalPages': None, 'pages': [], 'text': '', 'errorCode': None, 'blankPages': [], 'limitations': [], 'pageDetails': [], 'artifacts': [], 'retrievalOnly': False}
    try:
        extension = filename.rsplit('.', 1)[-1].lower()
        if MIMES.get(extension) != mime or len(data) < 1 or len(data) > max_bytes(extension):
            raise ProcessingError('unsupported_type_or_size')
        if hashlib.sha256(data).hexdigest() != expected_hash:
            raise ProcessingError('bytes_changed')
        output.mkdir(parents=True, exist_ok=True)
        if extension in {'txt', 'md', 'csv'}:
            text = data.decode('utf-8-sig', 'strict')
            if '\0' in text:
                raise ProcessingError('invalid_text')
            details = []
            if extension == 'csv':
                rows = list(csv.reader(io.StringIO(text)))
                if len(rows) > 50000 or any(len(row) > 500 for row in rows):
                    raise ProcessingError('table_limit')
                details = [{'page': 1, 'method': 'csv', 'rows': rows, 'typesInferred': False}]
            pages, artifacts, limitations = [text], [], []
        elif extension == 'pdf':
            pages, details, artifacts, limitations = pdf(data, output)
        elif extension in {'jpg', 'jpeg', 'png', 'webp', 'gif'}:
            pages, details, artifacts, limitations = raster(data, extension, output)
        elif extension in {'docx', 'pptx', 'xlsx'}:
            pages, details, artifacts, limitations = office(data, extension, output)
        elif extension == 'svg':
            pages, details, artifacts, limitations = svg(data, output)
        elif extension in {'mp4', 'webm'}:
            pages, details, artifacts, limitations = video(data, extension, output)
        else:
            from fontTools.ttLib import TTFont, TTLibError
            try:
                with TTFont(io.BytesIO(data), lazy=False, checkChecksums=2, recalcBBoxes=False, recalcTimestamp=False) as font:
                    expected_flavor = extension if extension in {'woff', 'woff2'} else None
                    if font.flavor != expected_flavor or len(font.keys()) > 100 or not all(key in font for key in ['head','maxp','name','cmap']):
                        raise ProcessingError('invalid_font')
                    if font['maxp'].numGlyphs > 100000:
                        raise ProcessingError('font_glyph_limit')
                    names = [{'nameId': n.nameID, 'text': n.toUnicode()} for n in font['name'].names if n.nameID in {1,2,4,6,13,14}]
                    pages, details, artifacts, limitations = [''], [{'page': 1, 'method': 'fonttools-4.66.1', 'names': names}], [], ['Original font retained. Embedded license text is evidence, not an automatic usage license. Review rights before publication.']
            except TTLibError as error:
                raise ProcessingError('invalid_font') from error
        text = '\n\n'.join(pages)
        if len(text.encode()) > MAX_TEXT or len(json.dumps(details).encode()) > 5 * MAX_TEXT:
            raise ProcessingError('extraction_output_limit')
        retrieval_only = (extension == 'pdf' and bool(artifacts) and not text.strip()) or extension in {'jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm'}
        if not text.strip() and not retrieval_only:
            raise ProcessingError('no_text')
        return {**base, 'complete': True, 'totalPages': len(pages), 'pages': pages, 'text': text, 'blankPages': [i + 1 for i, text in enumerate(pages) if not text.strip()], 'limitations': limitations, 'pageDetails': details, 'artifacts': artifacts, 'retrievalOnly': retrieval_only}
    except (ProcessingError, UnicodeError, ValueError, IndexError, KeyError, OSError, subprocess.SubprocessError, XML.ParseError, DefusedXmlException) as error:
        code = str(error) if isinstance(error, ProcessingError) else 'extraction_failed'
        return {**base, 'errorCode': code}
