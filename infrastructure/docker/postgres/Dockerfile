# PostgreSQL with PostGIS and pgvector extensions
FROM postgis/postgis:16-3.4-alpine

# Install pgvector
RUN apk add --no-cache --virtual .build-deps \
        git \
        build-base \
        clang15 \
        llvm15-dev \
    && cd /tmp \
    && git clone --branch v0.6.0 https://github.com/pgvector/pgvector.git \
    && cd pgvector \
    && make \
    && make install \
    && cd / \
    && rm -rf /tmp/pgvector \
    && apk del .build-deps
