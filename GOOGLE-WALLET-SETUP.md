# JMX Digital Card — Google Wallet Setup

The project includes the secure callable Firebase Function `createGoogleWalletPass`. The service-account private key is never placed in browser code.

## Configuration used
- Issuer ID: `3388000000023177664`
- Generic Class ID: `3388000000023177664.jmx_digital_card`
- Origin: `https://jmxdigitalcard.com`
- Image: `https://jmxdigitalcard.com/google-wallet-jmx.jpg`
- Firebase secret: `GOOGLE_WALLET_SERVICE_ACCOUNT`

## 1. Keep the JSON key private
Do not upload the service-account JSON to GitHub or place it inside this ZIP.

## 2. Create the secret
Run from the project root:
```bash
firebase functions:secrets:set GOOGLE_WALLET_SERVICE_ACCOUNT
```
When prompted, paste the entire contents of the authorized service-account JSON.

## 3. Install dependencies
```bash
cd functions
npm install
cd ..
```

## 4. Deploy only the new Function
```bash
firebase deploy --only functions:createGoogleWalletPass
```
This does not delete existing JMX Functions.

## 5. Publish the website
Publish the updated web files normally. Keep `google-wallet-jmx.jpg` at the project root with exactly that filename.

## 6. Test safely
Use one activated test card. In Feature Control Center, enable Google Wallet globally and for that card's plan. Keep its client override ON. Open the card editor and press **Add to Google Wallet**.

The first call creates the Wallet object; later calls update/reuse that same object. Card IDs and activation codes are never changed.

## Troubleshooting
- Permission error: verify the service-account email is authorized in Google Pay & Wallet Console for this issuer.
- Class not found: verify `3388000000023177664.jmx_digital_card`.
- Image missing: verify `https://jmxdigitalcard.com/google-wallet-jmx.jpg` opens publicly over HTTPS.
- Demo/Publishing Access is controlled by Google Wallet Console and cannot be bypassed by code.

## Rotate the secret
Run `firebase functions:secrets:set GOOGLE_WALLET_SERVICE_ACCOUNT` again, redeploy only `createGoogleWalletPass`, then revoke the old Google Cloud key after confirming the new deployment.
