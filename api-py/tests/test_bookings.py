PAYLOAD = {
    "customer_name": "Ana Souza",
    "customer_email": "ana@example.com",
    "vehicle_plate": "GC-1001",
    "pickup_date": "2026-11-01",
    "return_date": "2026-11-04",
}


def test_create_booking_calculates_total_and_reference(client):
    r = client.post("/bookings", json=PAYLOAD)
    assert r.status_code == 201
    body = r.json()
    assert body["reference"] == "GC-000001"
    assert body["status"] == "confirmed"
    assert body["total_price"] == 150  # 3 dias x 50


def test_return_date_must_be_after_pickup(client):
    r = client.post("/bookings", json={**PAYLOAD, "return_date": "2026-11-01"})
    assert r.status_code == 422


def test_invalid_email_is_rejected(client):
    r = client.post("/bookings", json={**PAYLOAD, "customer_email": "not-an-email"})
    assert r.status_code == 422


def test_unknown_vehicle_returns_404(client):
    r = client.post("/bookings", json={**PAYLOAD, "vehicle_plate": "XX-0000"})
    assert r.status_code == 404


def test_overlapping_dates_return_409(client):
    client.post("/bookings", json=PAYLOAD)
    r = client.post("/bookings", json={**PAYLOAD, "pickup_date": "2026-11-03", "return_date": "2026-11-06"})
    assert r.status_code == 409


def test_back_to_back_bookings_are_allowed(client):
    client.post("/bookings", json=PAYLOAD)
    r = client.post("/bookings", json={**PAYLOAD, "pickup_date": "2026-11-04", "return_date": "2026-11-06"})
    assert r.status_code == 201


def test_list_filters_by_status(client):
    first = client.post("/bookings", json=PAYLOAD).json()
    client.post("/bookings", json={**PAYLOAD, "vehicle_plate": "GC-1002"})
    client.post(f"/bookings/{first['id']}/cancel")
    assert len(client.get("/bookings").json()) == 2
    assert len(client.get("/bookings?status=cancelled").json()) == 1


def test_get_missing_booking_returns_404(client):
    assert client.get("/bookings/999").status_code == 404


def test_update_recalculates_total(client):
    booking = client.post("/bookings", json=PAYLOAD).json()
    r = client.put(f"/bookings/{booking['id']}", json={
        "customer_name": "Ana Souza",
        "customer_email": "ana@example.com",
        "pickup_date": "2026-11-01",
        "return_date": "2026-11-06",
    })
    assert r.status_code == 200
    assert r.json()["total_price"] == 250


def test_cancel_twice_returns_409_and_frees_the_dates(client):
    booking = client.post("/bookings", json=PAYLOAD).json()
    assert client.post(f"/bookings/{booking['id']}/cancel").status_code == 200
    assert client.post(f"/bookings/{booking['id']}/cancel").status_code == 409
    assert client.post("/bookings", json=PAYLOAD).status_code == 201
