"""ROUTER = as URLs. Só recebe o pedido, chama o service e devolve a resposta. Sem regra de negócio."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.booking import BookingCreate, BookingOut, BookingUpdate
from app.services import booking_service as service

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.get("", response_model=list[BookingOut])
def list_bookings(
    status: str | None = Query(None, description="confirmed or cancelled"),
    vehicle_plate: str | None = None,
    db: Session = Depends(get_db),
):
    return service.list_bookings(db, status, vehicle_plate)


@router.get("/{booking_id}", response_model=BookingOut)
def get_booking(booking_id: int, db: Session = Depends(get_db)):
    return service.get_booking(db, booking_id)


@router.post("", response_model=BookingOut, status_code=201)
def create_booking(data: BookingCreate, db: Session = Depends(get_db)):
    return service.create_booking(db, data)


@router.put("/{booking_id}", response_model=BookingOut)
def update_booking(booking_id: int, data: BookingUpdate, db: Session = Depends(get_db)):
    return service.update_booking(db, booking_id, data)


@router.post("/{booking_id}/cancel", response_model=BookingOut)
def cancel_booking(booking_id: int, db: Session = Depends(get_db)):
    return service.cancel_booking(db, booking_id)
