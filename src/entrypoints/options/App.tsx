import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import {
  createDebouncedSave,
  loadProfile,
  SchemaDowngradeError,
} from '@/core/profile/storage';
import { emptyProfile, type Profile } from '@/core/profile/schema';
import { stripPrototypePollution } from '@/core/profile/migrate';
import { profileSchema } from '@/core/profile/schema';
import { ADAPTERS } from '@/core/ai';
import { saveKeysPlain } from '@/core/ai/keystore';
import type { AiSettings } from '@/shared/messaging';
import type { ProviderId } from '@/core/ai/types';

const AI_SETTINGS_KEY = 'ai:settings';
/** Guards against an import file large enough to wedge the page. */
const MAX_IMPORT_BYTES = 2_000_000;

export function App() {
  const [profile, setProfile] = useState<Profile | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const saver = useMemo(() => createDebouncedSave(400), []);

  useEffect(() => {
    void loadProfile()
      .then(setProfile)
      .catch((e: unknown) => {
        setError(
          e instanceof SchemaDowngradeError
            ? 'Your saved profile was written by a newer version of fieldwise. Update the extension rather than risk overwriting it.'
            : 'Could not read your profile.',
        );
      });
  }, []);

  const update = (next: Profile) => {
    setProfile(next);
    saver.save(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  if (error) return <main class="fw-options"><p class="fw-error">{error}</p></main>;
  if (!profile) return <main class="fw-options"><p class="fw-muted">Loading…</p></main>;

  return (
    <main class="fw-options">
      <header class="fw-o-head">
        <h1>fieldwise</h1>
        <span class="fw-muted fw-small">
          {saved ? 'Saved' : 'Stored on this machine only'}
        </span>
      </header>

      <Identity profile={profile} onChange={update} />
      <Address profile={profile} onChange={update} />
      <Links profile={profile} onChange={update} />
      <Eligibility profile={profile} onChange={update} />
      <WorkHistory profile={profile} onChange={update} />
      <Education profile={profile} onChange={update} />
      <AiSection />
      <DataSection profile={profile} onChange={update} />
    </main>
  );
}

/* ---------------------------------------------------------------- fields */

/**
 * A text-like input.
 *
 * Preact 11 types `<input>` as a union discriminated on `type`, which only
 * narrows against a literal at the JSX site. So the text-like types live here
 * and the date-like ones get their own component below, rather than casting
 * past the checker.
 */
function Field(props: {
  label: string;
  value: string | undefined;
  onInput: (v: string) => void;
  type?: 'text' | 'email' | 'tel' | 'url';
  placeholder?: string;
  hint?: string;
}) {
  const shared = {
    value: props.value ?? '',
    placeholder: props.placeholder ?? '',
    onInput: (e: Event) => props.onInput((e.target as HTMLInputElement).value),
  };

  return (
    <label class="fw-field">
      <span>{props.label}</span>
      {props.type === 'email' ? (
        <input type="email" {...shared} />
      ) : props.type === 'tel' ? (
        <input type="tel" {...shared} />
      ) : props.type === 'url' ? (
        <input type="url" {...shared} />
      ) : (
        <input type="text" {...shared} />
      )}
      {props.hint && <small class="fw-muted">{props.hint}</small>}
    </label>
  );
}

/** A year-and-month input, which is the precision job forms actually want. */
function MonthField(props: {
  label: string;
  value: string | undefined;
  onInput: (v: string) => void;
}) {
  return (
    <label class="fw-field">
      <span>{props.label}</span>
      <input
        type="month"
        value={props.value ?? ''}
        onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
      />
    </label>
  );
}

function Tri(props: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  hint?: string;
}) {
  const current = props.value === undefined ? '' : props.value ? 'yes' : 'no';
  return (
    <label class="fw-field">
      <span>{props.label}</span>
      <select
        value={current}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          props.onChange(v === '' ? undefined : v === 'yes');
        }}
      >
        <option value="">Not answered</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
      {props.hint && <small class="fw-muted">{props.hint}</small>}
    </label>
  );
}

type SectionProps = { profile: Profile; onChange: (p: Profile) => void };

function Identity({ profile, onChange }: SectionProps) {
  const set = (patch: Partial<Profile['identity']>) =>
    onChange({ ...profile, identity: { ...profile.identity, ...patch } });
  const setContact = (patch: Partial<Profile['contact']>) =>
    onChange({ ...profile, contact: { ...profile.contact, ...patch } });

  return (
    <section class="fw-section">
      <h2>You</h2>
      <div class="fw-grid">
        <Field label="First name" value={profile.identity.firstName} onInput={(v) => set({ firstName: v })} />
        <Field label="Middle name" value={profile.identity.middleName} onInput={(v) => set({ middleName: v })} />
        <Field label="Last name" value={profile.identity.lastName} onInput={(v) => set({ lastName: v })} />
        <Field label="Preferred name" value={profile.identity.preferredName} onInput={(v) => set({ preferredName: v })} />
        <Field label="Pronouns" value={profile.identity.pronouns} onInput={(v) => set({ pronouns: v })} />
        <Field label="Email" type="email" value={profile.contact.email} onInput={(v) => setContact({ email: v })} />
        <Field label="Phone" type="tel" value={profile.contact.phone} onInput={(v) => setContact({ phone: v })} />
        <Field
          label="Phone country code"
          value={profile.contact.phoneCountryCode}
          onInput={(v) => setContact({ phoneCountryCode: v })}
          placeholder="+1"
          hint="Workday asks for this separately."
        />
      </div>
    </section>
  );
}

function Address({ profile, onChange }: SectionProps) {
  const set = (patch: Partial<Profile['address']>) =>
    onChange({ ...profile, address: { ...profile.address, ...patch } });

  return (
    <section class="fw-section">
      <h2>Address</h2>
      <div class="fw-grid">
        <Field label="Line 1" value={profile.address.line1} onInput={(v) => set({ line1: v })} />
        <Field label="Line 2" value={profile.address.line2} onInput={(v) => set({ line2: v })} />
        <Field label="City" value={profile.address.city} onInput={(v) => set({ city: v })} />
        <Field label="State / Province" value={profile.address.state} onInput={(v) => set({ state: v })} hint="Full name; the abbreviation is tried too." />
        <Field label="Postal code" value={profile.address.postalCode} onInput={(v) => set({ postalCode: v })} />
        <Field label="Country" value={profile.address.country} onInput={(v) => set({ country: v })} />
      </div>
    </section>
  );
}

function Links({ profile, onChange }: SectionProps) {
  const set = (patch: Partial<Profile['links']>) =>
    onChange({ ...profile, links: { ...profile.links, ...patch } });

  return (
    <section class="fw-section">
      <h2>Links</h2>
      <div class="fw-grid">
        <Field label="LinkedIn" value={profile.links.linkedin} onInput={(v) => set({ linkedin: v })} placeholder="https://" />
        <Field label="GitHub" value={profile.links.github} onInput={(v) => set({ github: v })} placeholder="https://" />
        <Field label="Portfolio" value={profile.links.portfolio} onInput={(v) => set({ portfolio: v })} placeholder="https://" />
        <Field label="Website" value={profile.links.website} onInput={(v) => set({ website: v })} placeholder="https://" />
      </div>
    </section>
  );
}

function Eligibility({ profile, onChange }: SectionProps) {
  const set = (patch: Partial<Profile['eligibility']>) =>
    onChange({ ...profile, eligibility: { ...profile.eligibility, ...patch } });

  return (
    <section class="fw-section">
      <h2>Work eligibility</h2>
      <div class="fw-grid">
        <Tri
          label="Authorised to work in your country of application"
          value={profile.eligibility.workAuthorized}
          onChange={(v) => set({ workAuthorized: v })}
        />
        <Tri
          label="Require visa sponsorship"
          value={profile.eligibility.requiresSponsorship}
          onChange={(v) => set({ requiresSponsorship: v })}
          hint="Asked separately on purpose: forms word these two almost identically but they mean opposite things."
        />
        <Tri label="Willing to relocate" value={profile.eligibility.willRelocate} onChange={(v) => set({ willRelocate: v })} />
      </div>
    </section>
  );
}

function WorkHistory({ profile, onChange }: SectionProps) {
  const update = (index: number, patch: Partial<Profile['work'][number]>) => {
    const work = profile.work.map((w, i) => (i === index ? { ...w, ...patch } : w));
    onChange({ ...profile, work });
  };

  const add = () =>
    onChange({
      ...profile,
      work: [...profile.work, { id: crypto.randomUUID(), isCurrent: false }],
    });

  const remove = (index: number) =>
    onChange({ ...profile, work: profile.work.filter((_, i) => i !== index) });

  return (
    <section class="fw-section">
      <h2>Work history</h2>
      <p class="fw-muted fw-small">
        In order, most recent first. Forms with several employer rows are filled in this order.
      </p>
      {profile.work.map((entry, i) => (
        <div class="fw-entry" key={entry.id}>
          <div class="fw-grid">
            <Field label="Company" value={entry.company} onInput={(v) => update(i, { company: v })} />
            <Field label="Title" value={entry.title} onInput={(v) => update(i, { title: v })} />
            <Field label="Location" value={entry.location} onInput={(v) => update(i, { location: v })} />
            <MonthField label="Start" value={entry.startDate} onInput={(v) => update(i, { startDate: v })} />
            <MonthField label="End" value={entry.endDate} onInput={(v) => update(i, { endDate: v })} />
          </div>
          <label class="fw-check">
            <input
              type="checkbox"
              checked={entry.isCurrent}
              onChange={(e) => update(i, { isCurrent: (e.target as HTMLInputElement).checked })}
            />
            I currently work here
          </label>
          <label class="fw-field">
            <span>Description</span>
            <textarea
              rows={3}
              value={entry.description ?? ''}
              onInput={(e) => update(i, { description: (e.target as HTMLTextAreaElement).value })}
            />
          </label>
          <button type="button" class="fw-link" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={add}>Add a role</button>
    </section>
  );
}

function Education({ profile, onChange }: SectionProps) {
  const update = (index: number, patch: Partial<Profile['education'][number]>) => {
    const education = profile.education.map((e, i) => (i === index ? { ...e, ...patch } : e));
    onChange({ ...profile, education });
  };

  const add = () =>
    onChange({ ...profile, education: [...profile.education, { id: crypto.randomUUID() }] });

  const remove = (index: number) =>
    onChange({ ...profile, education: profile.education.filter((_, i) => i !== index) });

  return (
    <section class="fw-section">
      <h2>Education</h2>
      {profile.education.map((entry, i) => (
        <div class="fw-entry" key={entry.id}>
          <div class="fw-grid">
            <Field label="School" value={entry.school} onInput={(v) => update(i, { school: v })} />
            <Field label="Degree" value={entry.degree} onInput={(v) => update(i, { degree: v })} />
            <Field label="Field of study" value={entry.field} onInput={(v) => update(i, { field: v })} />
            <MonthField label="Start" value={entry.startDate} onInput={(v) => update(i, { startDate: v })} />
            <MonthField label="End" value={entry.endDate} onInput={(v) => update(i, { endDate: v })} />
            <Field label="GPA" value={entry.gpa} onInput={(v) => update(i, { gpa: v })} />
          </div>
          <button type="button" class="fw-link" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={add}>Add a school</button>
    </section>
  );
}

/* ------------------------------------------------------------------- ai */

function AiSection() {
  const [settings, setSettings] = useState<AiSettings | undefined>();
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    void browser.storage.local.get(AI_SETTINGS_KEY).then((stored) => {
      setSettings({
        enabled: false,
        provider: 'gemini',
        model: ADAPTERS.gemini.defaultModel,
        allowedOrigins: [],
        ...(stored[AI_SETTINGS_KEY] as Partial<AiSettings> | undefined),
      });
    });
  }, []);

  if (!settings) return null;

  const save = (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void browser.storage.local.set({ [AI_SETTINGS_KEY]: next });
  };

  const adapter = ADAPTERS[settings.provider];

  return (
    <section class="fw-section">
      <h2>AI fallback</h2>
      <p class="fw-muted fw-small">
        When a field can&rsquo;t be worked out from its label, your chosen provider can be asked
        what kind of field it is. It is sent the field&rsquo;s shape — label text and attribute
        names — and never your profile, never the page text, and never a value. It is off until
        you turn it on, and then only on sites you allow one at a time.
      </p>

      <label class="fw-check">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => save({ enabled: (e.target as HTMLInputElement).checked })}
        />
        Enable the AI fallback
      </label>

      {settings.enabled && (
        <div class="fw-grid">
          <label class="fw-field">
            <span>Provider</span>
            <select
              value={settings.provider}
              onChange={(e) => {
                const provider = (e.target as HTMLSelectElement).value as ProviderId;
                save({ provider, model: ADAPTERS[provider].defaultModel });
              }}
            >
              {Object.values(ADAPTERS).map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>

          <label class="fw-field">
            <span>Model</span>
            <select value={settings.model} onChange={(e) => save({ model: (e.target as HTMLSelectElement).value })}>
              {adapter.suggestedModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>

          <label class="fw-field">
            <span>{adapter.label} API key</span>
            <input
              type="password"
              value={apiKey}
              placeholder="Paste your key"
              onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
            />
            <small class="fw-muted">
              Stored on this machine, in the extension&rsquo;s own storage. There is no truly
              secret storage in a browser extension: anything that can read your browser profile
              directory can read this key. It is never synced and never leaves your machine
              except to {adapter.label}.
            </small>
          </label>

          <button
            type="button"
            onClick={() => {
              void saveKeysPlain({ [settings.provider]: apiKey }).then(() => {
                setApiKey('');
                setKeySaved(true);
                window.setTimeout(() => setKeySaved(false), 1500);
              });
            }}
            disabled={apiKey.trim() === ''}
          >
            {keySaved ? 'Key saved' : 'Save key'}
          </button>
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- data */

function DataSection({ profile, onChange }: SectionProps) {
  const [message, setMessage] = useState<string | undefined>();

  const exportProfile = () => {
    // The API key is deliberately not included. An exported file ends up in
    // Downloads and often in a cloud-synced folder.
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fieldwise-profile.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProfile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      setMessage('That file is too large to be a profile.');
      return;
    }
    try {
      // Untrusted: this may be a file somebody was sent. Prototype-polluting
      // keys are stripped before the schema ever sees it.
      const raw = stripPrototypePollution(JSON.parse(await file.text()));
      const parsed = profileSchema.safeParse(raw);
      if (!parsed.success) {
        setMessage('That file is not a fieldwise profile.');
        return;
      }
      onChange(parsed.data);
      setMessage('Profile replaced.');
    } catch {
      setMessage('That file could not be read.');
    }
  };

  return (
    <section class="fw-section">
      <h2>Your data</h2>
      <div class="fw-row-actions">
        <button type="button" onClick={exportProfile}>Export profile</button>
        <label class="fw-file">
          Import profile
          <input
            type="file"
            accept="application/json"
            onChange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) void importProfile(file);
            }}
          />
        </label>
        <button
          type="button"
          class="fw-danger"
          onClick={() => {
            if (confirm('Erase your whole profile? This cannot be undone.')) {
              onChange(emptyProfile());
              setMessage('Profile cleared.');
            }
          }}
        >
          Clear profile
        </button>
      </div>
      {message && <p class="fw-muted">{message}</p>}
      <p class="fw-muted fw-small">
        Exports do not include your API key. Everything here stays on this machine — there is no
        account and no server.
      </p>
    </section>
  );
}
