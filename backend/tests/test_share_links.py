import presentation.app as pres_app
from tests.conftest import make_test_client


def test_share_links_prioritizes_lan_ip_over_localhost(monkeypatch):
    """
    Регрессия: раньше первым (и, значит, автокопируемым в буфер обмена) шёл
    request.url.hostname — обычно localhost/127.0.0.1, недоступный с других
    устройств. Реально рабочий LAN-адрес должен быть первым.
    """
    monkeypatch.setattr(pres_app, "_discover_local_ips", lambda: ["192.168.1.42"])
    client = make_test_client(monkeypatch)

    r = client.get("/api/share-links", headers={"host": "localhost:8000"})
    assert r.status_code == 200
    urls = r.json()["urls"]
    assert urls[0] == "http://192.168.1.42:8000/"
    assert "http://localhost:8000/" in urls


def test_share_links_keeps_current_host_first_when_not_loopback(monkeypatch):
    monkeypatch.setattr(pres_app, "_discover_local_ips", lambda: ["192.168.1.42"])
    client = make_test_client(monkeypatch)

    r = client.get("/api/share-links", headers={"host": "192.168.1.42:8000"})
    assert r.status_code == 200
    urls = r.json()["urls"]
    assert urls[0] == "http://192.168.1.42:8000/"
    assert urls.count("http://192.168.1.42:8000/") == 1


def test_share_links_falls_back_to_current_host_when_no_lan_ip_found(monkeypatch):
    monkeypatch.setattr(pres_app, "_discover_local_ips", lambda: [])
    client = make_test_client(monkeypatch)

    r = client.get("/api/share-links", headers={"host": "localhost:8000"})
    assert r.status_code == 200
    assert r.json()["urls"] == ["http://localhost:8000/"]
