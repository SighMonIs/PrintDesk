FROM python:3-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY run.sh .
CMD ["sh", "run.sh"]
