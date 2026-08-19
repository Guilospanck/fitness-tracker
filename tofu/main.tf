provider "aws" {
  region = var.aws_region
}

# ---- S3 bucket ------------------------------------------------------------

resource "aws_s3_bucket" "backups" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Keep costs bounded: expire old daily backups. Versioning above keeps a
# short history of overwrites as an extra safety net.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {
      prefix = "${var.backup_prefix}/"
    }
    expiration {
      days = 90
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ---- IAM user with write-only-JSON policy --------------------------------

resource "aws_iam_user" "backup" {
  name = var.iam_user_name
}

data "aws_iam_policy_document" "backup_upload" {
  statement {
    sid     = "AllowDailyJsonBackupOnly"
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.backups.arn}/${var.backup_prefix}/fitness-tracker-*.json",
    ]
  }
}

resource "aws_iam_user_policy" "backup_upload" {
  name   = "fitness-tracker-backup-upload"
  user   = aws_iam_user.backup.name
  policy = data.aws_iam_policy_document.backup_upload.json
}

resource "aws_iam_access_key" "backup" {
  user = aws_iam_user.backup.name
}
