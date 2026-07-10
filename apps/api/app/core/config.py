from functools import cached_property

from pydantic import AnyUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    root_domain: str = "uas.ahbvc.org.pt"
    database_url: str = "postgresql+asyncpg://uas_platform:uas_platform@postgres:5432/uas_platform"
    redis_url: str = "redis://redis:6379/0"
    api_cors_origins: str = "https://uas.ahbvc.org.pt,https://pilot.uas.ahbvc.org.pt"

    jwt_secret_key: str = Field(default="change-me", min_length=8)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 14

    dji_app_id: str | None = None
    dji_app_key: str | None = None
    dji_app_secret: str | None = None
    dji_app_basic_license: str | None = None
    dji_workspace_id: str | None = None
    dji_workspace_name: str = "AHBVC UAS Platform"
    dji_pilot_api_token: str | None = None
    dji_cloud_api_docs_url: AnyUrl = "https://developer.dji.com/doc/cloud-api-tutorial/en/"

    mqtt_public_host: str = "mqtt.uas.ahbvc.org.pt"
    mqtt_public_scheme: str = "ssl"
    mqtt_public_url: str | None = None
    mqtt_tls_port: int = 8883
    mqtt_internal_host: str = "emqx"
    mqtt_internal_port: int = 1883
    mqtt_pilot_username: str | None = None
    mqtt_pilot_password: str | None = None

    stream_public_host: str = "stream.uas.ahbvc.org.pt"
    stream_rtmp_port: int = 1935

    s3_bucket: str = "uas-media"
    s3_endpoint_url: str = "http://minio:9000"
    s3_public_endpoint: str = "https://storage.uas.ahbvc.org.pt"

    @cached_property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]

    @property
    def pilot_mqtt_url(self) -> str:
        if self.mqtt_public_url:
            return self.mqtt_public_url
        if not self.mqtt_public_scheme:
            return f"{self.mqtt_public_host}:{self.mqtt_tls_port}"
        return f"{self.mqtt_public_scheme}://{self.mqtt_public_host}:{self.mqtt_tls_port}"


settings = Settings()
