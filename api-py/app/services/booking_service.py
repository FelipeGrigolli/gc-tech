"""SERVICE = regras de negócio. O router chama aqui; aqui é que se decide o que é permitido.

Manter as regras fora do router deixa as rotas finas e as regras testáveis.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Booking, Vehicle
from app.schemas.booking import BookingCreate, BookingUpdate


class NotFound(Exception):
    pass


class BusinessRuleError(Exception):
    """Pedido válido no formato, mas proibido pelas regras (vira HTTP 409)."""


def _has_overlap(db: Session, plate: str, pickup, return_, ignore_id: int | None = None) -> bool:
    # Dois períodos se sobrepõem quando um começa antes de o outro terminar.
    query = select(Booking.id).where(
        Booking.vehicle_plate == plate,
        Booking.status != "cancelled",
        Booking.pickup_date < return_,
        Booking.return_date > pickup,
    )
    if ignore_id is not None:
        query = query.where(Booking.id != ignore_id)
    return db.scalar(query) is not None


def _total(vehicle: Vehicle, pickup, return_) -> float:
    return float(vehicle.daily_rate) * (return_ - pickup).days


def list_bookings(db: Session, status: str | None, vehicle_plate: str | None) -> list[Booking]:
    query = select(Booking).order_by(Booking.id.desc())
    if status:
        query = query.where(Booking.status == status)
    if vehicle_plate:
        query = query.where(Booking.vehicle_plate == vehicle_plate)
    return list(db.scalars(query))


def get_booking(db: Session, booking_id: int) -> Booking:
    booking = db.get(Booking, booking_id)
    if booking is None:
        raise NotFound(f"Booking {booking_id} not found")
    return booking


def create_booking(db: Session, data: BookingCreate) -> Booking:
    vehicle = db.get(Vehicle, data.vehicle_plate)
    if vehicle is None:
        raise NotFound(f"Vehicle {data.vehicle_plate} not found")
    if _has_overlap(db, data.vehicle_plate, data.pickup_date, data.return_date):
        raise BusinessRuleError("Vehicle is not available for these dates")

    booking = Booking(
        reference="PENDING",  # trocada logo abaixo, quando o banco já gerou o id
        customer_name=data.customer_name,
        customer_email=data.customer_email,
        vehicle_plate=data.vehicle_plate,
        pickup_date=data.pickup_date,
        return_date=data.return_date,
        status="confirmed",
        total_price=_total(vehicle, data.pickup_date, data.return_date),
    )
    db.add(booking)
    db.flush()  # grava sem finalizar, para o banco gerar o id
    booking.reference = f"GC-{booking.id:06d}"
    db.commit()
    db.refresh(booking)
    return booking


def update_booking(db: Session, booking_id: int, data: BookingUpdate) -> Booking:
    booking = get_booking(db, booking_id)
    if booking.status == "cancelled":
        raise BusinessRuleError("Cancelled bookings cannot be edited")
    if _has_overlap(db, booking.vehicle_plate, data.pickup_date, data.return_date, ignore_id=booking.id):
        raise BusinessRuleError("Vehicle is not available for these dates")

    booking.customer_name = data.customer_name
    booking.customer_email = data.customer_email
    booking.pickup_date = data.pickup_date
    booking.return_date = data.return_date
    booking.total_price = _total(booking.vehicle, data.pickup_date, data.return_date)
    db.commit()
    db.refresh(booking)
    return booking


def cancel_booking(db: Session, booking_id: int) -> Booking:
    booking = get_booking(db, booking_id)
    if booking.status == "cancelled":
        raise BusinessRuleError("Booking is already cancelled")
    booking.status = "cancelled"  # não apagamos: o histórico fica no banco
    db.commit()
    db.refresh(booking)
    return booking
