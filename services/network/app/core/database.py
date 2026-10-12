from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from .config import Settings

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import Settings


def new_lifespan(settings: Settings):
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:

        MONGO_URI = f"mongodb://{settings.MONGO_ROOT_USERNAME}:{settings.MONGO_ROOT_PASSWORD}@{settings.MONGO_HOST}"

        client = AsyncMongoClient(MONGO_URI)

        try:
            await client.admin.command("ping")

            app.state.mongodb_client = client
            app.state.mongodb = client[settings.MONGO_DB]

            yield
        finally:
            await client.close()

    return lifespan

def get_database(app: FastAPI) -> AsyncDatabase:
    return app.state.mongodb