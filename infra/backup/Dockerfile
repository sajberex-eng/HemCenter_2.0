# Tools image for backups: PostgreSQL client matching the server, plus gpg for encryption.
FROM postgres:16
RUN apt-get update && apt-get install -y --no-install-recommends gnupg tar findutils && rm -rf /var/lib/apt/lists/*
COPY *.sh /scripts/
RUN chmod +x /scripts/*.sh
