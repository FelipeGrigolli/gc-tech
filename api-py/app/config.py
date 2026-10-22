"""Configuração da aplicação. Valores vêm de variáveis de ambiente, com padrão para dev local."""
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/gctech.db")
