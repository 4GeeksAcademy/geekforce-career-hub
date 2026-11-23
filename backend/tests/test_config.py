"""The API refuses to start with a JWT secret anyone could know."""
import pytest

from app.config import Settings, check_jwt_secret, jwt_secret_problem

STRONG = "x" * 48


@pytest.mark.parametrize("secret", ["", "change-me-in-production", "generate-a-long-random-string", "  CHANGEME ", "short"])
def test_unsafe_secrets_are_flagged(secret):
    assert jwt_secret_problem(secret)


def test_long_random_secret_is_fine():
    assert jwt_secret_problem(STRONG) is None


def test_startup_fails_with_default_secret():
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        check_jwt_secret(Settings(jwt_secret="change-me-in-production", dev_password_login=False))


def test_local_dev_only_warns(caplog):
    check_jwt_secret(Settings(jwt_secret="change-me-in-production", dev_password_login=True))
    assert "JWT_SECRET" in caplog.text


def test_startup_ok_with_strong_secret():
    check_jwt_secret(Settings(jwt_secret=STRONG, dev_password_login=False))
