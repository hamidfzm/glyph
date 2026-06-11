# Microsoft Store packaging

Tracks Glyph's Microsoft Store listing. See [issue #292](https://github.com/hamidfzm/glyph/issues/292).

## Approach

The Store now accepts traditional Win32 installers, so Glyph submits the same
WiX `.msi` that `release.yml` already builds (`Glyph_<version>_x64_en-US.msi`).
This avoids an MSIX repackage/resign step. If tighter integration (Store
auto-update, clean uninstall) is needed later, switch to MSIX.

## One-time maintainer setup

1. Register a [Microsoft Partner Center](https://partner.microsoft.com/dashboard)
   developer account (one-time registration fee).
2. Reserve the app name **Glyph** and complete the Store listing: description,
   screenshots, age rating questionnaire, and privacy policy URL.
3. Create an Azure AD application and link it in Partner Center to obtain the
   Store submission API credentials.
4. Add the following GitHub repository secrets:
   - `PARTNER_CENTER_TENANT_ID`
   - `PARTNER_CENTER_CLIENT_ID`
   - `PARTNER_CENTER_CLIENT_SECRET`
   - `PARTNER_CENTER_SELLER_ID`
   - `PARTNER_CENTER_PRODUCT_ID`

## Automation (follow-up)

Once the account exists and the packaging path (installer vs MSIX) is locked in,
add a `publish-msstore` job to
[`.github/workflows/release.yml`](../.github/workflows/release.yml) that
downloads the release artifact and submits it via the
[Microsoft Store submission API](https://learn.microsoft.com/partner-center/marketplace/submission-api-onboarding)
(e.g. the `microsoft/store-submission` action), gated on the `PARTNER_CENTER_*`
secrets so it stays a no-op until configured. This is intentionally deferred:
the submission inputs depend on the Partner Center product type, which is part
of the one-time setup above.
