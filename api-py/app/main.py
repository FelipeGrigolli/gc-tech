"""Ponto de entrada: monta o app, liga o banco, registra rotas e traduz erros em respostas HTTP."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app import models  # noqa: F401  (garante que as tabelas estão registradas)
from app.database import Base, SessionLocal, engine
from app.models import Vehicle
from app.routers import bookings
from app.services.booking_service import BusinessRuleError, NotFound


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Roda uma vez quando o servidor sobe: cria as tabelas e os dados de exemplo."""
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.query(Vehicle).count() == 0:
            db.add_all([
                Vehicle(plate="GC-1001", category="compact", daily_rate=45),
                Vehicle(plate="GC-1002", category="suv", daily_rate=80),
                Vehicle(plate="GC-2001", category="truck", daily_rate=140),
            ])
            db.commit()
    yield


app = FastAPI(title="GC Tech API", version="0.1.0", lifespan=lifespan)
app.include_router(bookings.router)


@app.exception_handler(NotFound)
def not_found_handler(request: Request, exc: NotFound):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(BusinessRuleError)
def business_rule_handler(request: Request, exc: BusinessRuleError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.get("/health")
def health():
    return {"status": "ok"}
