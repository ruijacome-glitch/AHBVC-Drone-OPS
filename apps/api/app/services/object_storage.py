import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.core.config import settings


class ObjectStorage:
    def __init__(self) -> None:
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key or settings.minio_root_user,
            aws_secret_access_key=settings.s3_secret_key or settings.minio_root_password,
            config=Config(signature_version="s3v4"),
            region_name="us-east-1",
        )

    def put_pdf(self, key: str, content: bytes) -> None:
        bucket = settings.s3_bucket
        try:
            self.client.head_bucket(Bucket=bucket)
        except ClientError:
            self.client.create_bucket(Bucket=bucket)
        self.client.put_object(
            Bucket=bucket,
            Key=key,
            Body=content,
            ContentType="application/pdf",
        )

    def get(self, bucket: str, key: str) -> bytes:
        response = self.client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()


object_storage = ObjectStorage()
