# README

## Local running:

### build ruby image
docker-compose build

### initial run
docker-compose up -d db
docker-compose run web rake db:create db:migrate

### subsequent runs
docker-compose up

### site should be available at
https://localhost:3000

## Migrating database:

add new migration script under db/migrate
docker-compose run web rake db:migrate