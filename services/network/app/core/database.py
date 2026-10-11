from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from .config import settings

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    client = AsyncMongoClient(settings.MONGO_HOST)

    try:
        await client.admin.command("ping")

        app.state.mongodb_client = client
        app.state.mongodb = client[settings.MONGO_DB]

        yield
    finally:
        await client.close()


def get_database(app: FastAPI) -> AsyncDatabase:
    return app.state.mongodb