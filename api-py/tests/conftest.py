"""Fixtures do pytest: um banco SQLite em memória, novo a cada teste, no lugar do banco real."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Vehicle


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    with Session() as db:
        db.add_all([
            Vehicle(plate="GC-1001", category="compact", daily_rate=50),
            Vehicle(plate="GC-1002", category="suv", daily_rate=80),
        ])
        db.commit()

    def override_get_db():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)  # sem "with": não dispara o startup que mexe no banco real
    app.dependency_overrides.clear()
