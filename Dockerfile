# Multi-stage build: compile the Angular SPA and the .NET API, then ship one small runtime image.
# The API serves the SPA from wwwroot, so a single container hosts the whole application.

# ---- Stage 1: build the Angular frontend ----
FROM node:20-alpine AS web
WORKDIR /src/web
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
RUN npx ng build --configuration production

# ---- Stage 2: build and publish the .NET API ----
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS api
WORKDIR /src/api
COPY apps/api/Eshopper.Api/*.csproj ./
RUN dotnet restore
COPY apps/api/Eshopper.Api/ ./
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# ---- Stage 3: runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app
COPY --from=api /app/publish ./
# Drop the built SPA into wwwroot so MapFallback can serve client-side routes.
COPY --from=web /src/web/dist/eshopper-web/browser/ ./wwwroot/
RUN mkdir -p ./wwwroot/uploads

# Render injects $PORT at runtime; default to 8080 for local runs.
ENV ASPNETCORE_ENVIRONMENT=Production
ENV PORT=8080
EXPOSE 8080

# Shell form so $PORT is expanded at container start, not at build time.
ENTRYPOINT ["/bin/sh", "-c", "ASPNETCORE_URLS=http://+:${PORT} dotnet Eshopper.Api.dll"]
