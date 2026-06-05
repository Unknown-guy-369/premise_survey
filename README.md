# Premise Lead Survey

Standalone React app for surveying PG/hostel premises and scoring sales leads for Mighty Kitchen / Soul Bowl.

## What It Does

- Loads 247 premise leads extracted from `Mighty_Kitchen_PG_Lead_Bank - Sheet1.pdf`.
- Shows pending premises first so survey staff do not repeat completed surveys.
- Opens Google Maps directions for the selected premise.
- Captures the seven survey questions using multiple choice, checkboxes, and short answers.
- Scores each premise out of 10 and classifies it as hot, warm, or cold.
- Saves survey results to Firebase Firestore so multiple survey takers see shared data.
- Exports client-ready results as CSV or JSON.
- Protects the Admin Report tab with basic client-side authentication.

## Admin Login

Default credentials:

- Username: `admin`
- Password: `admin123`

To override them in Vite, set:

- `VITE_ADMIN_USERNAME`
- `VITE_ADMIN_PASSWORD`

## Firebase Firestore

Create a Firebase web app, enable Firestore, then add these Vite env values:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIRESTORE_SURVEY_COLLECTION=premiseLeadSurveys
```

`VITE_FIRESTORE_SURVEY_COLLECTION` is optional. If omitted, the app uses `premiseLeadSurveys`.

For a temporary public survey site, you can start with simple Firestore rules like this, then disable the site or tighten rules after the campaign:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /premiseLeadSurveys/{premiseId} {
      allow read, create, update, delete: if true;
    }
  }
}
```

The admin password in this app is basic client-side protection for the UI. Firestore rules are what actually control database access.

## Lead Scoring

Each matching factor gives 2 points:

- 20+ residents
- Food problem exists
- Decision maker available
- Open to sample/trial
- Within easy delivery route

Score actions:

- 8-10: Hot lead, give sample fast
- 5-7: Warm lead, follow up
- 0-4: Cold lead, keep in list

## Project Files

- `src/App.jsx`: Main survey workflow, scoring logic, local save, report, exports.
- `src/data/premises.js`: Premise seed data extracted from the PDF.
- `src/styles.css`: Responsive UI styling.
