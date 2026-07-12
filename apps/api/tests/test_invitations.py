from app.services.invitations import environment


def test_invitation_template_escapes_user_values() -> None:
    html = environment.get_template("user_invitation.html").render(
        activation_url="https://uas.ahbvc.org.pt/activate?token=safe-token",
        email="user@example.org",
        full_name="<script>alert(1)</script>",
        roles="Piloto",
        expiry_hours=24,
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "safe-token" in html
