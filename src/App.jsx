import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ClipboardCheck,
  Download,
  FileJson,
  LockKeyhole,
  ListFilter,
  LogOut,
  MapPinned,
  Navigation,
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { premises } from './data/premises.js';
import { db, isFirebaseConfigured } from './firebase.js';

const ADMIN_AUTH_KEY = 'premise-lead-survey-admin-authenticated';
const ADMIN_USERNAME = import.meta.env.VITE_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'admin123';
const SURVEY_COLLECTION = import.meta.env.VITE_FIRESTORE_SURVEY_COLLECTION || 'premiseLeadSurveys';

const emptySurvey = {
  residentCount: '',
  foodArrangement: '',
  currentHandler: '',
  complaints: [],
  complaintNotes: '',
  openTrial: '',
  decisionMakerRole: '',
  decisionMakerName: '',
  decisionMakerPhone: '',
  preferredOption: '',
  easyDeliveryRoute: '',
  notes: '',
};

function leadQuality(score) {
  if (score >= 8) {
    return { label: 'Hot lead', action: 'Give sample fast', tone: 'hot' };
  }

  if (score >= 5) {
    return { label: 'Warm lead', action: 'Follow up', tone: 'warm' };
  }

  return { label: 'Cold lead', action: "Keep in list, don't waste time now", tone: 'cold' };
}

function calculateScore(survey) {
  const residents = Number(survey.residentCount || 0);
  const hasComplaint = survey.complaints.some((item) => item !== 'No major complaints');
  const decisionMakerAvailable = survey.decisionMakerRole && survey.decisionMakerRole !== 'Not available';

  return [
    residents >= 20,
    hasComplaint,
    decisionMakerAvailable,
    survey.openTrial === 'Yes',
    survey.easyDeliveryRoute === 'Yes',
  ].filter(Boolean).length * 2;
}

function mapUrl(premise) {
  const destination = [premise.name, premise.address, premise.area, 'Chennai'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export default function App() {
  const [activeView, setActiveView] = useState('survey');
  const [adminAuthenticated, setAdminAuthenticated] = useState(() => {
    try {
      return sessionStorage.getItem(ADMIN_AUTH_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [adminForm, setAdminForm] = useState({ username: '', password: '' });
  const [adminError, setAdminError] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(premises[0]?.id ?? '');
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState('all');
  const [area, setArea] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState(emptySurvey);
  const [surveys, setSurveys] = useState({});
  const [isSurveySaving, setIsSurveySaving] = useState(false);
  const [dataStatus, setDataStatus] = useState(() =>
    isFirebaseConfigured ? 'Connecting to Firestore...' : 'Firebase is not configured. Add Vite Firebase env values.',
  );
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, SURVEY_COLLECTION),
      (snapshot) => {
        const nextSurveys = {};
        snapshot.forEach((item) => {
          nextSurveys[item.id] = item.data();
        });
        setSurveys(nextSurveys);
        setDataStatus('Firestore connected. Survey results sync live across devices.');
        setDataError('');
      },
      (error) => {
        setDataStatus('Firestore sync failed.');
        setDataError(error.message);
      },
    );

    return unsubscribe;
  }, []);

  const selectedPremise = premises.find((premise) => premise.id === selectedId) ?? premises[0];
  const selectedSurvey = surveys[selectedPremise?.id];

  const phases = useMemo(
    () => [...new Set(premises.map((premise) => premise.priorityPhase).filter(Boolean))].sort(),
    [],
  );

  const areas = useMemo(
    () => [...new Set(premises.map((premise) => premise.area).filter(Boolean))].sort(),
    [],
  );

  const filteredPremises = useMemo(() => {
    const term = search.trim().toLowerCase();

    return premises.filter((premise) => {
      const isDone = Boolean(surveys[premise.id]);
      const matchesStatus = showAll || !isDone;
      const matchesPhase = phase === 'all' || premise.priorityPhase === phase;
      const matchesArea = area === 'all' || premise.area === area;
      const haystack = `${premise.id} ${premise.name} ${premise.area} ${premise.address}`.toLowerCase();
      const matchesSearch = !term || haystack.includes(term);

      return matchesStatus && matchesPhase && matchesArea && matchesSearch;
    });
  }, [area, phase, search, showAll, surveys]);

  const reportRows = useMemo(
    () =>
      premises
        .map((premise) => ({ premise, survey: surveys[premise.id] }))
        .filter((row) => row.survey)
        .sort((a, b) => b.survey.score - a.survey.score || a.premise.id.localeCompare(b.premise.id)),
    [surveys],
  );

  const stats = useMemo(() => {
    const completed = reportRows.length;
    const hot = reportRows.filter((row) => row.survey.quality.tone === 'hot').length;
    const warm = reportRows.filter((row) => row.survey.quality.tone === 'warm').length;
    const cold = reportRows.filter((row) => row.survey.quality.tone === 'cold').length;
    const average = completed
      ? (reportRows.reduce((sum, row) => sum + row.survey.score, 0) / completed).toFixed(1)
      : '0.0';

    return { total: premises.length, pending: premises.length - completed, completed, hot, warm, cold, average };
  }, [reportRows]);

  function selectPremise(id) {
    setSelectedId(id);
    setSurveyOpen(false);
    setDraft(surveys[id]?.answers ?? emptySurvey);
  }

  function openSurvey() {
    setDraft(selectedSurvey?.answers ?? emptySurvey);
    setSurveyOpen(true);
  }

  function updateDraft(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function toggleComplaint(value) {
    setDraft((current) => {
      const exists = current.complaints.includes(value);
      let complaints = exists
        ? current.complaints.filter((item) => item !== value)
        : [...current.complaints, value];

      if (value === 'No major complaints' && !exists) {
        complaints = ['No major complaints'];
      } else if (value !== 'No major complaints') {
        complaints = complaints.filter((item) => item !== 'No major complaints');
      }

      return { ...current, complaints };
    });
  }

  async function saveSurvey(event) {
    event.preventDefault();
    if (!db) {
      setDataError('Firebase is not configured, so this survey cannot be saved.');
      return;
    }

    const score = calculateScore(draft);
    const quality = leadQuality(score);
    const savedSurvey = {
      premiseId: selectedPremise.id,
      answers: draft,
      score,
      quality,
      surveyedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    };

    try {
      setIsSurveySaving(true);
      await setDoc(doc(db, SURVEY_COLLECTION, selectedPremise.id), savedSurvey, { merge: true });
      setSurveyOpen(false);
      setDataError('');
    } catch (error) {
      setDataError(error.message);
    } finally {
      setIsSurveySaving(false);
    }
  }

  function exportCsv() {
    const headers = [
      'Lead ID',
      'Premise',
      'Area',
      'Phone',
      'Score',
      'Lead Status',
      'Recommended Action',
      'Residents',
      'Food Arrangement',
      'Current Handler',
      'Complaints',
      'Open Trial',
      'Decision Maker Role',
      'Decision Maker Name',
      'Decision Maker Phone',
      'Preferred Option',
      'Easy Delivery Route',
      'Notes',
      'Surveyed At',
    ];

    const lines = reportRows.map(({ premise, survey }) => {
      const answers = survey.answers;
      return [
        premise.id,
        premise.name,
        premise.area,
        premise.phone,
        survey.score,
        survey.quality.label,
        survey.quality.action,
        answers.residentCount,
        answers.foodArrangement,
        answers.currentHandler,
        answers.complaints.join('; '),
        answers.openTrial,
        answers.decisionMakerRole,
        answers.decisionMakerName,
        answers.decisionMakerPhone,
        answers.preferredOption,
        answers.easyDeliveryRoute,
        answers.notes,
        survey.surveyedAt,
      ].map(csvValue).join(',');
    });

    downloadFile('premise-lead-survey-results.csv', [headers.map(csvValue).join(','), ...lines].join('\n'), 'text/csv');
  }

  function exportJson() {
    const payload = reportRows.map(({ premise, survey }) => ({ premise, survey }));
    downloadFile('premise-lead-survey-results.json', JSON.stringify(payload, null, 2), 'application/json');
  }

  function openReport() {
    if (adminAuthenticated) {
      setActiveView('report');
      return;
    }

    setAdminError('');
    setAdminForm({ username: '', password: '' });
    setAuthDialogOpen(true);
  }

  function submitAdminLogin(event) {
    event.preventDefault();

    if (adminForm.username === ADMIN_USERNAME && adminForm.password === ADMIN_PASSWORD) {
      setAdminAuthenticated(true);
      sessionStorage.setItem(ADMIN_AUTH_KEY, 'true');
      setAuthDialogOpen(false);
      setActiveView('report');
      return;
    }

    setAdminError('Invalid admin username or password.');
  }

  function logoutAdmin() {
    setAdminAuthenticated(false);
    sessionStorage.removeItem(ADMIN_AUTH_KEY);
    setActiveView('survey');
  }

  function requestClearSurveys() {
    setConfirmClearOpen(true);
  }

  async function clearSurveys() {
    if (!db) {
      setDataError('Firebase is not configured, so saved surveys cannot be cleared.');
      setConfirmClearOpen(false);
      return;
    }

    try {
      const surveyIds = Object.keys(surveys);
      if (!surveyIds.length) {
        setConfirmClearOpen(false);
        return;
      }

      const batch = writeBatch(db);
      surveyIds.forEach((premiseId) => {
        batch.delete(doc(db, SURVEY_COLLECTION, premiseId));
      });
      await batch.commit();
      setSurveyOpen(false);
      setDraft(emptySurvey);
      setConfirmClearOpen(false);
      setDataError('');
    } catch (error) {
      setDataError(error.message);
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Mighty Kitchen / Soul Bowl</p>
          <h1>Premise Lead Survey</h1>
        </div>
        <nav className="view-tabs" aria-label="Views">
          <button className={activeView === 'survey' ? 'tab active' : 'tab'} onClick={() => setActiveView('survey')} type="button">
            <ClipboardCheck size={16} />
            Survey
          </button>
          <button className={activeView === 'report' ? 'tab active' : 'tab'} onClick={openReport} type="button">
            <BarChart3 size={16} />
            Admin Report
          </button>
        </nav>
      </header>

      <main>
        {activeView === 'survey' ? (
          <section aria-labelledby="surveyHeading">
            <SummaryStrip stats={stats} />
            <SyncBanner error={dataError} status={dataStatus} />
            <div className="survey-layout">
              <aside className="lead-panel" aria-labelledby="surveyHeading">
                <div className="panel-head">
                  <div>
                    <h2 id="surveyHeading">Available premises</h2>
                    <p>{filteredPremises.length} shown, {stats.pending} not surveyed</p>
                  </div>
                  <button className="ghost-button" onClick={() => setShowAll((value) => !value)} type="button">
                    <ListFilter size={16} />
                    {showAll ? 'Hide done' : 'Show all'}
                  </button>
                </div>

                <div className="filters">
                  <label className="search-box">
                    <Search size={16} />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Search name, area, lead ID" />
                  </label>
                  <select value={phase} onChange={(event) => setPhase(event.target.value)} aria-label="Priority phase">
                    <option value="all">All phases</option>
                    {phases.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                  <select value={area} onChange={(event) => setArea(event.target.value)} aria-label="Area">
                    <option value="all">All areas</option>
                    {areas.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>

                <div className="lead-list" role="list">
                  {filteredPremises.map((premise) => (
                    <LeadButton
                      key={premise.id}
                      active={premise.id === selectedPremise.id}
                      premise={premise}
                      survey={surveys[premise.id]}
                      onClick={() => selectPremise(premise.id)}
                    />
                  ))}
                </div>
              </aside>

              <PremiseDetail
                draft={draft}
                mapHref={mapUrl(selectedPremise)}
                onChange={updateDraft}
                onComplaintToggle={toggleComplaint}
                onOpenSurvey={openSurvey}
                onSave={saveSurvey}
                premise={selectedPremise}
                saving={isSurveySaving}
                survey={selectedSurvey}
                surveyOpen={surveyOpen}
              />
            </div>
          </section>
        ) : (
          <ReportView
            dataError={dataError}
            dataStatus={dataStatus}
            onClear={requestClearSurveys}
            onExportCsv={exportCsv}
            onExportJson={exportJson}
            onLogout={logoutAdmin}
            rows={reportRows}
            stats={stats}
          />
        )}
      </main>

      {authDialogOpen ? (
        <AdminAuthDialog
          error={adminError}
          form={adminForm}
          onCancel={() => setAuthDialogOpen(false)}
          onChange={setAdminForm}
          onSubmit={submitAdminLogin}
        />
      ) : null}

      {confirmClearOpen ? (
        <ConfirmDialog
          completedCount={stats.completed}
          onCancel={() => setConfirmClearOpen(false)}
          onConfirm={clearSurveys}
        />
      ) : null}
    </>
  );
}

function SummaryStrip({ stats }) {
  return (
    <div className="summary-strip">
      <Stat label="Total leads" value={stats.total} />
      <Stat label="Pending survey" value={stats.pending} />
      <Stat label="Completed" value={stats.completed} />
      <Stat label="Hot leads" value={stats.hot} />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SyncBanner({ error, status }) {
  return (
    <div className={error ? 'sync-banner error' : 'sync-banner'}>
      <strong>{error ? 'Firestore issue' : 'Sync status'}</strong>
      <span>{error || status}</span>
    </div>
  );
}

function LeadButton({ active, premise, survey, onClick }) {
  return (
    <button className={active ? 'lead-item active' : 'lead-item'} onClick={onClick} role="listitem" type="button">
      <span>
        <span className="lead-title">{premise.name}</span>
        <span className="lead-meta">{premise.id} · {premise.area} · {premise.priorityPhase}</span>
      </span>
      {survey ? <span className={`score-pill ${survey.quality.tone}`}>{survey.score}/10</span> : <span className="status-pill">Pending</span>}
    </button>
  );
}

function PremiseDetail({ draft, mapHref, onChange, onComplaintToggle, onOpenSurvey, onSave, premise, saving, survey, surveyOpen }) {
  if (!premise) {
    return (
      <section className="detail-panel">
        <div className="empty-state">
          <h2>No premise selected</h2>
          <p>Adjust the filters to find a lead.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="detail-panel" aria-live="polite">
      <div className="premise-card">
        <div>
          <p className="eyebrow">{premise.id}</p>
          <h2>{premise.name}</h2>
          <p className="selected-meta">{premise.area} · {premise.genderType} · {premise.priorityPhase}</p>
        </div>
        {survey ? <span className={`score-pill ${survey.quality.tone}`}>{survey.quality.label} · {survey.score}/10</span> : <span className="status-pill">Not surveyed</span>}
      </div>

      <div className="location-box">
        <div>
          <h3>Location</h3>
          <p>{premise.address || 'Address not available in PDF seed.'}</p>
          <p className="muted">Phone: {premise.phone || 'Not available'} · Plus code: {premise.plusCode || 'Not available'}</p>
        </div>
        <div className="location-actions">
          <a className="map-button" href={mapHref} target="_blank" rel="noreferrer">
            <Navigation size={16} />
            Directions
          </a>
          <button className="primary-button compact" onClick={onOpenSurvey} type="button">
            <MapPinned size={16} />
            {survey ? 'Edit survey' : 'Take survey'}
          </button>
        </div>
      </div>

      {survey && !surveyOpen ? (
        <div className="saved-box">
          <h3>Saved result</h3>
          <p><strong>{survey.score}/10 - {survey.quality.label}.</strong> {survey.quality.action}.</p>
          <p className="muted">Last saved {new Date(survey.surveyedAt).toLocaleString()}</p>
        </div>
      ) : null}

      {surveyOpen ? (
        <SurveyForm draft={draft} onChange={onChange} onComplaintToggle={onComplaintToggle} onSave={onSave} saving={saving} />
      ) : null}
    </section>
  );
}

function SurveyForm({ draft, onChange, onComplaintToggle, onSave, saving }) {
  const score = calculateScore(draft);
  const quality = leadQuality(score);

  return (
    <form className="survey-form" onSubmit={onSave}>
      <h3>Survey questions</h3>

      <label className="field">
        <span>1. How many residents are staying here currently?</span>
        <input name="residentCount" value={draft.residentCount} onChange={(event) => onChange('residentCount', event.target.value)} type="number" min="0" inputMode="numeric" required />
      </label>

      <RadioGroup
        legend="2. Do they provide food, or do residents arrange individually?"
        name="foodArrangement"
        options={['PG provides food', 'Residents arrange individually', 'Mixed', 'Unknown']}
        value={draft.foodArrangement}
        onChange={onChange}
      />

      <RadioGroup
        legend="3. If food is provided, who handles it now?"
        name="currentHandler"
        options={['Own cook', 'Outside vendor', 'Both', 'Not applicable', 'Unknown']}
        value={draft.currentHandler}
        onChange={onChange}
      />

      <fieldset>
        <legend>4. Are there food complaints?</legend>
        <div className="checkbox-grid">
          {['Taste', 'Timing', 'Price', 'Hygiene', 'Quantity', 'No major complaints'].map((option) => (
            <label key={option}>
              <input checked={draft.complaints.includes(option)} onChange={() => onComplaintToggle(option)} type="checkbox" />
              {option}
            </label>
          ))}
        </div>
        <input value={draft.complaintNotes} onChange={(event) => onChange('complaintNotes', event.target.value)} type="text" placeholder="Short note if needed" />
      </fieldset>

      <RadioGroup
        legend="5. Open to sample meal or short trial?"
        name="openTrial"
        options={['Yes', 'Maybe', 'No']}
        value={draft.openTrial}
        onChange={onChange}
      />

      <fieldset>
        <legend>6. Right decision maker</legend>
        <div className="radio-row">
          {['Owner', 'Manager', 'Admin', 'Residents', 'Not available'].map((option) => (
            <label key={option}>
              <input checked={draft.decisionMakerRole === option} name="decisionMakerRole" onChange={() => onChange('decisionMakerRole', option)} type="radio" required />
              {option}
            </label>
          ))}
        </div>
        <div className="two-col">
          <input value={draft.decisionMakerName} onChange={(event) => onChange('decisionMakerName', event.target.value)} type="text" placeholder="Name" />
          <input value={draft.decisionMakerPhone} onChange={(event) => onChange('decisionMakerPhone', event.target.value)} type="tel" placeholder="Phone number" />
        </div>
      </fieldset>

      <RadioGroup
        legend="7. Which option suits them better?"
        name="preferredOption"
        options={['Bulk food for PG', 'Individual app subscription', 'Both', 'Unsure']}
        value={draft.preferredOption}
        onChange={onChange}
      />

      <RadioGroup
        legend="Delivery route check"
        name="easyDeliveryRoute"
        options={['Yes', 'No']}
        labels={{ Yes: 'Within easy delivery route', No: 'Not easy for delivery' }}
        value={draft.easyDeliveryRoute}
        onChange={onChange}
      />

      <label className="field">
        <span>Survey notes</span>
        <textarea value={draft.notes} onChange={(event) => onChange('notes', event.target.value)} rows="3" placeholder="Anything the client should know" />
      </label>

      <div className={`score-preview ${quality.tone}`}>
        Current score: <strong>{score}/10</strong> · {quality.label} · {quality.action}
      </div>
      <button className="primary-button" disabled={saving} type="submit">
        <ClipboardCheck size={16} />
        {saving ? 'Saving...' : 'Save survey'}
      </button>
    </form>
  );
}

function RadioGroup({ labels = {}, legend, name, onChange, options, value }) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option}>
          <input checked={value === option} name={name} onChange={() => onChange(name, option)} type="radio" required />
          {labels[option] ?? option}
        </label>
      ))}
    </fieldset>
  );
}

function ReportView({ dataError, dataStatus, onClear, onExportCsv, onExportJson, onLogout, rows, stats }) {
  return (
    <section aria-labelledby="reportHeading">
      <div className="report-head">
        <div>
          <p className="eyebrow">Admin view</p>
          <h2 id="reportHeading">Lead quality report</h2>
        </div>
        <div className="actions">
          <button onClick={onLogout} type="button">
            <LogOut size={16} />
            Logout
          </button>
          <button onClick={onExportCsv} type="button">
            <Download size={16} />
            Export CSV
          </button>
          <button onClick={onExportJson} type="button">
            <FileJson size={16} />
            Export JSON
          </button>
          <button className="danger-button" onClick={onClear} type="button">
            <RotateCcw size={16} />
            Clear saved surveys
          </button>
        </div>
      </div>

      <SyncBanner error={dataError} status={dataStatus} />

      <div className="report-grid">
        <Stat label="Completed" value={stats.completed} />
        <Stat label="Average score" value={stats.average} />
        <Stat label="Hot leads" value={stats.hot} />
        <Stat label="Warm / cold" value={`${stats.warm} / ${stats.cold}`} />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Lead</th>
              <th>Premise</th>
              <th>Area</th>
              <th>Score</th>
              <th>Status</th>
              <th>Action</th>
              <th>Decision maker</th>
              <th>Surveyed</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map(({ premise, survey }) => (
              <tr key={premise.id}>
                <td>{premise.id}</td>
                <td>
                  <strong>{premise.name}</strong>
                  <div className="muted">{premise.phone || 'No phone in seed'}</div>
                </td>
                <td>{premise.area}</td>
                <td><span className={`score-pill ${survey.quality.tone}`}>{survey.score}/10</span></td>
                <td>{survey.quality.label}</td>
                <td>{survey.quality.action}</td>
                <td>
                  {survey.answers.decisionMakerRole}
                  <div className="muted">{survey.answers.decisionMakerName || '-'} {survey.answers.decisionMakerPhone || ''}</div>
                </td>
                <td>{new Date(survey.surveyedAt).toLocaleString()}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan="8" className="empty-cell">No surveys saved yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdminAuthDialog({ error, form, onCancel, onChange, onSubmit }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="adminAuthTitle">
        <div className="dialog-icon">
          <LockKeyhole size={22} />
        </div>
        <div>
          <p className="eyebrow">Protected area</p>
          <h2 id="adminAuthTitle">Admin authentication</h2>
          <p className="muted">Enter admin credentials to view reports, exports, and survey controls.</p>
        </div>

        <form className="dialog-form" onSubmit={onSubmit}>
          <label className="field">
            <span>Username</span>
            <input
              autoComplete="username"
              autoFocus
              value={form.username}
              onChange={(event) => onChange({ ...form, username: event.target.value })}
              required
              type="text"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              value={form.password}
              onChange={(event) => onChange({ ...form, password: event.target.value })}
              required
              type="password"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="dialog-actions">
            <button onClick={onCancel} type="button">Cancel</button>
            <button className="primary-button compact" type="submit">
              <ShieldCheck size={16} />
              Login
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ConfirmDialog({ completedCount, onCancel, onConfirm }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="clearDataTitle">
        <div className="dialog-icon danger">
          <RotateCcw size={22} />
        </div>
        <div>
          <p className="eyebrow">Confirm clear</p>
          <h2 id="clearDataTitle">Are you sure?</h2>
          <p className="muted">
            This will delete {completedCount} saved survey {completedCount === 1 ? 'result' : 'results'} from this browser.
          </p>
        </div>
        <div className="dialog-actions">
          <button onClick={onCancel} type="button">Cancel</button>
          <button className="danger-solid-button" onClick={onConfirm} type="button">
            Clear data
          </button>
        </div>
      </section>
    </div>
  );
}
