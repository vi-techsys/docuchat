# PostgreSQL with pgvector Setup

## Start PostgreSQL with pgvector

```bash
docker run -d \
  --name docuchat-postgres \
  -e POSTGRES_USER=docuchat \
  -e POSTGRES_PASSWORD=docuchat_dev \
  -e POSTGRES_DB=docuchat \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

## Verify Connection

```bash
docker exec -it docuchat-postgres psql -U docuchat -c 'SELECT 1;'
```

## Setup Database

1. Enable pgvector extension:
```bash
docker exec -it docuchat-postgres psql -U docuchat -d docuchat -f /docker-entrypoint-initdb.d/setup-pgvector.sql
```

2. Run Prisma migrations:
```bash
npx prisma migrate dev --name add_vector_column
```

3. Create HNSW index:
```bash
docker exec -it docuchat-postgres psql -U docuchat -d docuchat -f /docker-entrypoint-initdb.d/create-hnsw-index.sql
```

## Environment Variables

The `.env` file has been updated with:
```
DATABASE_URL="postgresql://docuchat:docuchat_dev@localhost:5432/docuchat"
```
