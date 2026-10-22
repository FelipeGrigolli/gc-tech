"""SCHEMA = o formato do dado na API (o que entra e o que sai). O Pydantic valida sozinho.

Diferença para o model: o model fala com o BANCO, o schema fala com o CLIENTE da API.
"""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BookingBase(BaseModel):
    customer_name: str = Field(min_length=2, max_length=100)
    customer_email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    pickup_date: date
    return_date: date

    @model_validator(mode="after")
    def return_after_pickup(self):
        if self.return_date <= self.pickup_date:
            raise ValueError("return_date must be after pickup_date")
        return self


class BookingCreate(BookingBase):
    vehicle_plate: str = Field(min_length=3, max_length=10)


class BookingUpdate(BookingBase):
    """Edição: o veículo não muda, só cliente e datas."""


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # permite montar a partir de um model do banco

    id: int
    reference: str
    customer_name: str
    customer_email: str
    vehicle_plate: str
    pickup_date: date
    return_date: date
    status: str
    total_price: float
    created_at: datetime
