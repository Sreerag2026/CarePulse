# CarePulse

Patient monitoring website for parents and doctors. One Node/Express server serves both the
website (`public/`) and the API (`/api/...`), backed by MongoDB.

## Run locally

```bash
npm install
cp .env.example .env    # then fill in MONGO_URI and AUTH_SECRET
npm run dev
```

Open http://localhost:3000.

## Deploy on Render

Step-by-step guide covering MongoDB Atlas, Render settings and a custom www domain: [DEPLOY.md](DEPLOY.md).

- **Build command:** `npm install`
- **Start command:** `node server.js`
- **Environment variables** (Dashboard → Environment):
  - `MONGO_URI`: the Atlas connection string with the **database user's** password (Atlas →
    Database Access), not the Atlas account password. URL-encode special characters in the
    password (`@` → `%40`, `#` → `%23`, `%` → `%25`).
  - `AUTH_SECRET`: any long random string. Without it, everyone is logged out on every restart.
  - `DOCTOR_SIGNUP_CODE`: the code doctors enter to register on the website. If it's unset,
    doctor registration is closed.
  - `DEVICE_API_KEY` (optional): required in the `x-device-key` header when a device posts readings.

In MongoDB Atlas → Network Access, allow `0.0.0.0/0`, because Render's outgoing IP addresses change.

If the Render logs show `bad auth : authentication failed`, `MONGO_URI` has the wrong username
or password. The website still loads in that state, but logins and registration fail with
"database is not connected".

## Doctor accounts

Doctor accounts can see every patient, so only people with the registration code can create one.

- **On the website:** Doctor Login → **New doctor? Register**, then enter the code from
  `DOCTOR_SIGNUP_CODE`. Give the code only to real doctors. To stop new sign-ups, remove the
  variable or change it.
- **From the command line** (also resets a doctor's password), on a machine whose `.env` points at
  the same database:

  ```bash
  npm run create-doctor -- HOSP-2291 DR-0148 "a-strong-password" "Dr. Priya Nair"
  ```

## API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/health` | anyone |
| POST | `/api/register` | anyone |
| POST | `/api/parent-login` | anyone, returns a token |
| POST | `/api/reset-password` | anyone, with email + phone + patient ID |
| POST | `/api/doctor-register` | anyone with the `DOCTOR_SIGNUP_CODE` |
| POST | `/api/doctor-login` | anyone, returns a token |
| GET | `/api/patients` | doctor |
| GET | `/api/patient/:patientId` | doctor, or that patient's parent |
| PUT | `/api/patient/:patientId` | doctor |
| GET | `/api/patient/:patientId/readings?limit=100` | doctor, or that patient's parent |
| POST | `/api/patient/:patientId/reading` | device (`x-device-key`) or doctor |

Logged-in requests send `Authorization: Bearer <token>`.

A monitoring device posts readings like this:

```bash
curl -X POST https://<your-app>.onrender.com/api/patient/CP123456/reading \
  -H "Content-Type: application/json" -H "x-device-key: <DEVICE_API_KEY>" \
  -d '{"heartRate": 92, "oxygenLevel": 98, "temperature": 36.8, "bloodPressure": "110/70"}'
```
