from utils.url_safety import is_apartments_com_url, is_safe_public_url


class TestIsSafePublicUrl:
    def test_accepts_public_https_hostname(self):
        assert is_safe_public_url("https://www.example-apartments.com/floorplans")

    def test_accepts_public_http_hostname(self):
        assert is_safe_public_url("http://example.com")

    def test_rejects_none_and_empty(self):
        assert not is_safe_public_url(None)
        assert not is_safe_public_url("")

    def test_rejects_non_http_schemes(self):
        assert not is_safe_public_url("file:///etc/passwd")
        assert not is_safe_public_url("ftp://example.com/data")
        assert not is_safe_public_url("gopher://example.com")

    def test_rejects_localhost(self):
        assert not is_safe_public_url("http://localhost:8000/admin")
        assert not is_safe_public_url("http://internal.localhost/x")

    def test_rejects_private_and_loopback_ips(self):
        assert not is_safe_public_url("http://127.0.0.1/")
        assert not is_safe_public_url("http://10.0.0.5/")
        assert not is_safe_public_url("http://192.168.1.1/")
        assert not is_safe_public_url("http://169.254.169.254/latest/meta-data")

    def test_rejects_bare_internal_hostnames(self):
        assert not is_safe_public_url("http://supabase-db/")

    def test_rejects_embedded_credentials(self):
        assert not is_safe_public_url("https://user:pass@example.com/")

    def test_accepts_public_ip(self):
        assert is_safe_public_url("http://93.184.216.34/")


class TestIsApartmentsComUrl:
    def test_accepts_exact_hostnames(self):
        assert is_apartments_com_url("https://www.apartments.com/some-property/abc123/")
        assert is_apartments_com_url("https://apartments.com/some-property/abc123/")

    def test_rejects_substring_tricks(self):
        assert not is_apartments_com_url("https://evil.com/apartments.com/listing")
        assert not is_apartments_com_url("https://apartments.com.evil.com/listing")
        assert not is_apartments_com_url("https://notapartments.com/listing")

    def test_rejects_unsafe_urls(self):
        assert not is_apartments_com_url("file://apartments.com/x")
        assert not is_apartments_com_url(None)
