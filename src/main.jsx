import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import QRCode from 'qrcode'
import { isCloudMode, supabase } from './lib/supabase'
import './styles.css'
import './retention.css'
import './boop-theme.css'

const seedPet = {
  id: 'pet_8f4a9c2e', name: 'Milo', breed: 'Golden Retriever', species: 'Dog',
  age: '3 years', photo: '🐕', note: 'Milo is friendly but may be nervous around traffic.',
  publicPhoto: true, publicNote: true, missing: false
}

function loadPet() {
  try { return JSON.parse(localStorage.getItem('reunite-pet')) || seedPet } catch { return seedPet }
}

function App() {
  const [pet, setPet] = useState(loadPet)
  const [screen, setScreen] = useState(location.hash.startsWith('#/pet/') ? 'scan' : 'home')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [saved, setSaved] = useState(false)
  const [cloudUser, setCloudUser] = useState(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [inbox, setInbox] = useState([])
  const [inboxError, setInboxError] = useState('')

  useEffect(() => { localStorage.setItem('reunite-pet', JSON.stringify(pet)) }, [pet])
  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setCloudUser(data.session?.user ?? null)
      if (data.session?.user && isAuthCallback()) setNeedsPassword(true)
      if (data.session?.user) await loadCloudPet(data.session.user.id)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setCloudUser(session?.user ?? null)
      if (session?.user && (event === 'PASSWORD_RECOVERY' || isAuthCallback())) setNeedsPassword(true)
      if (session?.user) { loadCloudPet(session.user.id); loadInbox(session.user.id) }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (screen === 'scan' && supabase) {
      const token = location.hash.replace(/^#\/pet\//, '')
      supabase.rpc('get_public_pet_v2', { p_token: token }).then(({ data }) => {
        if (data?.[0]) setPet(current => ({ ...current, ...data[0], id: data[0].public_token, publicPhoto: data[0].public_photo, publicNote: data[0].public_note, photo: data[0].photo_url || '🐕' }))
      })
    }
  }, [screen])
  useEffect(() => {
    const onHash = () => setScreen(location.hash.startsWith('#/pet/') ? 'scan' : 'home')
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const publicUrl = `${location.origin}${location.pathname}#/pet/${pet.id}`
  const go = (next) => { if (next === 'scan') location.hash = `/pet/${pet.id}`; else { history.replaceState(null, '', location.pathname); setScreen(next) } }

  async function loadCloudPet(ownerId) {
    const { data, error } = await supabase.from('pets').select('*').eq('owner_id', ownerId).order('created_at').limit(1).maybeSingle()
    if (!error && data) setPet({ ...data, id: data.public_token, _dbId: data.id, photo: data.photo_url || '🐕' })
    if (!error && !data) {
      const { data: created, error: createError } = await supabase.from('pets').insert({ owner_id: ownerId, name: seedPet.name, species: seedPet.species, breed: seedPet.breed, age: seedPet.age, note: seedPet.note, public_photo: true, public_note: true, missing: false }).select().single()
      if (!createError && created) setPet({ ...created, id: created.public_token, _dbId: created.id, photo: created.photo_url || '🐕' })
      if (createError) setAuthError(createError.message)
    }
  }
  async function loadInbox(ownerId = cloudUser?.id) {
    if (!supabase || !ownerId) return
    const { data, error } = await supabase.from('conversations').select('id, pet_id, created_at, expires_at, pets(name), messages(id, sender_role, body, created_at, location_lat, location_lng, location_accuracy)').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
    if (error) setInboxError(error.message); else setInbox(data || [])
  }
  const update = (key, value) => { setPet(current => ({ ...current, [key]: value })); setSaved(false) }
  const saveProfile = async () => {
    if (supabase && cloudUser) {
      const payload = { owner_id: cloudUser.id, name: pet.name, species: pet.species, breed: pet.breed, age: pet.age, note: pet.note, public_photo: pet.publicPhoto, public_note: pet.publicNote, missing: pet.missing, photo_url: pet.photo_url || null }
      const query = pet._dbId ? supabase.from('pets').update(payload).eq('id', pet._dbId).select().single() : supabase.from('pets').insert(payload).select().single()
      const { data, error } = await query
      if (error) { setAuthError(error.message); return }
      setPet(current => ({ ...current, ...data, id: data.public_token, _dbId: data.id, photo: data.photo_url || current.photo || '🐕' }))
    }
    localStorage.setItem('reunite-pet', JSON.stringify(pet)); setSaved(true)
  }
  const authenticate = async (mode, email, password) => {
    setAuthBusy(true); setAuthError('')
    const result = mode === 'signup' ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password })
    if (result.error) setAuthError(result.error.message)
    else if (mode === 'signup' && !result.data.session) setAuthError('Check your email to confirm your account, then sign in.')
    setAuthBusy(false)
  }
  const setInvitePassword = async (password) => {
    setAuthBusy(true); setAuthError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setAuthError(error.message)
    else {
      setNeedsPassword(false)
      history.replaceState(null, '', location.pathname)
    }
    setAuthBusy(false)
  }
  const signOut = async () => { await supabase?.auth.signOut(); setCloudUser(null) }
  const uploadPhoto = async (file) => {
    if (!file || !supabase || !cloudUser || !pet._dbId) return
    if (!file.type.startsWith('image/')) { setAuthError('Please choose an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { setAuthError('Please choose an image smaller than 5 MB.'); return }
    setAuthError('Uploading photo…')
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const previousUrl = pet.photo_url
    const path = `${cloudUser.id}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage.from('reunite-media').upload(path, file, { contentType: file.type, upsert: false })
    if (error) { setAuthError(error.message); return }
    const { data } = supabase.storage.from('reunite-media').getPublicUrl(path)
    const { error: updateError } = await supabase.from('pets').update({ photo_url: data.publicUrl }).eq('id', pet._dbId)
    if (updateError) setAuthError(updateError.message); else {
      if (previousUrl?.includes('/storage/v1/object/public/reunite-media/')) {
        const oldPath = decodeURIComponent(previousUrl.split('/storage/v1/object/public/reunite-media/')[1])
        await supabase.storage.from('reunite-media').remove([oldPath])
      }
      setPet(current => ({ ...current, photo_url: data.publicUrl, photo: data.publicUrl })); setAuthError('')
    }
  }
  const deleteData = async () => {
    if (!supabase || !cloudUser) return
    const { error } = await supabase.rpc('delete_my_reunite_data')
    if (error) { setAuthError(error.message); return }
    localStorage.removeItem('reunite-pet'); await supabase.auth.signOut(); setCloudUser(null); setPet(seedPet)
  }
  const openInbox = async () => { await loadInbox(); go('inbox') }

  if (screen === 'scan') return <ScanPage pet={pet} message={message} setMessage={setMessage} sent={sent} setSent={setSent} />
  if (isCloudMode && cloudUser && needsPassword) return <SetPasswordPage submit={setInvitePassword} busy={authBusy} error={authError} />
  if (isCloudMode && !cloudUser) return <AuthPage authenticate={authenticate} busy={authBusy} error={authError} />
  if (screen === 'inbox') return <InboxPage inbox={inbox} error={inboxError} reload={loadInbox} go={go} supabase={supabase} />
  if (screen === 'edit') return <EditPage pet={pet} update={update} saveProfile={saveProfile} saved={saved} go={go} uploadPhoto={uploadPhoto} deleteData={deleteData} />
  return <Dashboard pet={pet} publicUrl={publicUrl} go={go} cloudUser={cloudUser} signOut={signOut} cloudMode={isCloudMode} openInbox={openInbox} inboxCount={inbox.length} />
}

function isAuthCallback() {
  const hash = decodeURIComponent(window.location.hash || '')
  return /(?:^|[&#?])type=(?:invite|recovery)(?:&|$)/i.test(hash)
}

function Shell({ children, go }) {
  return <div className="app-shell"><header className="topbar"><button className="brand" onClick={() => go('home')}><span className="brand-mark">R</span><span>reunite</span></button><nav><button onClick={() => go('home')}>Dashboard</button><button onClick={() => go('inbox')}>Inbox</button><button onClick={() => go('edit')}>Pet profile</button><span className="avatar">RD</span></nav></header>{children}</div>
}

function Dashboard({ pet, publicUrl, go, cloudUser, signOut, cloudMode, openInbox, inboxCount }) {
  return <Shell go={go}><main className="dashboard page"><div className="eyebrow">YOUR PET IDENTITY</div><div className="hero-row"><div><h1>A safer way<br /><em>home.</em></h1><p className="lead">A private digital identity for the pet you never want to lose.</p></div><div><div className="status-pill"><i /> {cloudMode ? 'Cloud profile active' : 'Demo profile active'}</div>{cloudUser && <button className="signout-btn" onClick={signOut}>Sign out</button>}</div></div>
    <section className="dashboard-grid"><article className="pet-card"><div className="pet-card-top"><div className="pet-avatar">{pet.photo}</div><div><div className="card-label">YOUR PET</div><h2>{pet.name}</h2><p>{pet.breed} · {pet.age}</p></div><button className="icon-btn" onClick={() => go('edit')} aria-label="Edit profile">↗</button></div><div className="privacy-row"><span><i className="lock">⌁</i> Private contact enabled</span><span className="online-dot">●</span></div></article>
    <QRCard publicUrl={publicUrl} />
    </section><section className="lower-grid"><div className="section-heading"><div><div className="eyebrow">A SIMPLE PROMISE</div><h3>Ready when it matters.</h3></div><button className="text-btn" onClick={() => go('edit')}>Manage profile <span>→</span></button></div><div className="steps"><Step n="01" title="Create" text="Keep the essentials in one trusted place."/><Step n="02" title="Attach" text="Print the QR or add it to any tag."/><Step n="03" title="Reconnect" text="A finder can reach you without seeing your details."/></div></section>
    <div className="owner-actions"><button className="primary-btn" onClick={openInbox}>Open inbox {inboxCount ? `(${inboxCount})` : ''} <span>→</span></button><span>Messages from finders stay private in your account.</span></div><div className="demo-note"><span>PRIVATE MODE</span> Your pet profile and finder messages are stored securely in your Reunite account.</div></main></Shell>
}

function AuthPage({ authenticate, busy, error }) {
  const [mode, setMode] = useState('signin'); const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  return <div className="auth-page"><div className="scan-brand"><span className="brand-mark">R</span> reunite</div><main className="auth-card"><div className="eyebrow">PRIVATE PET IDENTITY</div><h1>{mode === 'signin' ? 'Welcome back.' : 'Make a safe home.'}</h1><p>Sign in to manage your pet profile and keep it available wherever you are.</p><form onSubmit={e => { e.preventDefault(); authenticate(mode, email, password) }}><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" minLength="6" value={password} onChange={e => setPassword(e.target.value)} required /></label>{error && <div className="auth-error">{error}</div>}<button className="primary-btn wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} <span>→</span></button></form><button className="auth-toggle" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); }}> {mode === 'signin' ? 'Create a new account' : 'Already have an account? Sign in'} </button><small>Your pet profile is stored in your Reunite account.</small></main></div>
}

function SetPasswordPage({ submit, busy, error }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = confirm.length > 0 && password !== confirm
  return <div className="auth-page"><div className="scan-brand"><span className="brand-mark">R</span> reunite</div><main className="auth-card"><div className="eyebrow">ACCOUNT ACTIVATION</div><h1>Set your password.</h1><p>Your invitation worked. Choose a password to finish setting up your Reunite account.</p><form onSubmit={e => { e.preventDefault(); if (!mismatch) submit(password) }}><label>Password<input type="password" minLength="6" value={password} onChange={e => setPassword(e.target.value)} required /></label><label>Confirm password<input type="password" minLength="6" value={confirm} onChange={e => setConfirm(e.target.value)} required /></label>{mismatch && <div className="auth-error">The passwords do not match.</div>}{error && <div className="auth-error">{error}</div>}<button className="primary-btn wide" disabled={busy || mismatch}>{busy ? 'Saving…' : 'Finish account setup'} <span>→</span></button></form><small>Use at least 6 characters. Never share your password.</small></main></div>
}

function QRCard({ publicUrl }) {
  const [data, setData] = useState('')
  useEffect(() => { QRCode.toDataURL(publicUrl, { width: 220, margin: 1, color: { dark: '#20211f', light: '#ffffff' } }).then(setData) }, [publicUrl])
  return <article className="qr-card"><div className="card-label">YOUR REUNITE QR</div>{data ? <img className="qr" src={data} alt="QR code for the pet profile" /> : <div className="qr-placeholder">Generating…</div>}<p>Scan to view {publicUrl.includes('pet_') ? 'a safe contact page' : 'profile'}</p><div className="qr-actions"><a className="outline-btn" href={data} download="reunite-pet-qr.png">Download QR</a><button className="outline-btn" onClick={() => navigator.clipboard?.writeText(publicUrl)}>Copy link</button></div></article>
}

function Step({ n, title, text }) { return <div className="step"><span>{n}</span><div><h4>{title}</h4><p>{text}</p></div></div> }

function EditPage({ pet, update, saveProfile, saved, go, uploadPhoto, deleteData }) {
  return <Shell go={go}><main className="page edit-page"><button className="back-btn" onClick={() => go('home')}>← Back to dashboard</button><div className="eyebrow">PET PROFILE</div><h1>Tell their story.</h1><p className="lead">Only the information you choose to share will appear when someone scans the QR.</p><form onSubmit={e => { e.preventDefault(); saveProfile() }}><div className="photo-upload"><div className="photo-preview">{typeof pet.photo === 'string' && pet.photo.startsWith('http') ? <img src={pet.photo} alt={`${pet.name} profile`} /> : pet.photo}</div><div><label>Pet photo<input type="file" accept="image/*" onChange={e => uploadPhoto(e.target.files?.[0])} /></label><small>JPG, PNG or WEBP · max 5 MB</small></div></div><div className="form-grid"><label>Pet name<input value={pet.name} onChange={e => update('name', e.target.value)} required /></label><label>Breed<input value={pet.breed} onChange={e => update('breed', e.target.value)} required /></label><label>Species<select value={pet.species} onChange={e => update('species', e.target.value)}><option>Dog</option><option>Cat</option><option>Other</option></select></label><label>Age<input value={pet.age} onChange={e => update('age', e.target.value)} /></label></div><label>Safety note<textarea value={pet.note} onChange={e => update('note', e.target.value)} placeholder="Anything a finder should know?" /></label><div className="visibility"><div><h3>Public profile</h3><p>These settings control what a finder can see.</p></div><label className="switch-row"><input type="checkbox" checked={pet.publicPhoto} onChange={e => update('publicPhoto', e.target.checked)} /><span>Pet photo</span></label><label className="switch-row"><input type="checkbox" checked={pet.publicNote} onChange={e => update('publicNote', e.target.checked)} /><span>Safety note</span></label><label className="switch-row"><input type="checkbox" checked={pet.missing} onChange={e => update('missing', e.target.checked)} /><span>Mark missing</span></label></div><div className="form-footer"><span className="private-handle">Owner handle: <strong>@rishabh_reunite</strong> <small>public</small></span><button className="primary-btn" type="submit">{saved ? 'Saved ✓' : 'Save profile'}</button></div></form><div className="data-controls"><div><strong>Your data</strong><p>Conversations expire after 30 days. You can remove your pet profile and uploaded photos at any time.</p></div><button type="button" className="danger-btn" onClick={() => window.confirm('Delete your Reunite pet profile, conversations and uploaded photos? This cannot be undone.') && deleteData()}>Delete my data</button></div></main></Shell>
}

function ScanPage({ pet, message, setMessage, sent, setSent }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [coords, setCoords] = useState(null); const [locBusy, setLocBusy] = useState(false); const [locError, setLocError] = useState('')
  const shareLocation = () => { setLocBusy(true); setLocError(''); if (!navigator.geolocation) { setLocError('Location is not supported by this browser.'); setLocBusy(false); return } navigator.geolocation.getCurrentPosition(pos => { setCoords({ lat: Number(pos.coords.latitude.toFixed(3)), lng: Number(pos.coords.longitude.toFixed(3)), accuracy: pos.coords.accuracy }); setLocBusy(false) }, () => { setLocError('Location permission was denied. You can still send the message without it.'); setLocBusy(false) }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }) }
  const send = async () => { setBusy(true); setError(''); const token = location.hash.replace(/^#\/pet\//, ''); const result = supabase ? await supabase.rpc('send_public_message', { p_token: token, p_body: message.trim(), p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null, p_accuracy: coords?.accuracy ?? null }) : { error: null }; if (result.error) setError(result.error.message); else setSent(true); setBusy(false) }
  return <div className="scan-page"><div className="scan-brand"><span className="brand-mark">R</span> reunite</div><main className="scan-main"><div className="scan-eyebrow"><span className="scan-dot" /> You found a pet profile</div><div className="scan-pet-avatar">{pet.photo}</div><h1>Meet {pet.name}.</h1><p className="scan-sub">{pet.publicPhoto ? `${pet.breed} · ${pet.age}` : 'A pet who may need a little help getting home.'}</p>{pet.missing && <div className="missing-banner">This pet has been marked missing. Please contact their person.</div>}{pet.publicNote && <div className="safety-note"><span>✦</span><div><strong>A note from their family</strong><p>{pet.note}</p></div></div>}<div className="owner-card"><div className="owner-initial">R</div><div><div className="card-label">THEIR PERSON</div><strong>@rishabh_reunite</strong><p>Contact is private and secure</p></div></div>{sent ? <div className="sent-state"><span>✓</span><div><strong>Message sent safely</strong><p>Their person will receive your message{coords ? ' and approximate location' : ''} in their Reunite inbox.</p></div></div> : <div className="message-box"><label htmlFor="message">Send a private message</label><textarea id="message" value={message} onChange={e => setMessage(e.target.value)} placeholder="Where did you find them?" maxLength="2000" /><button type="button" className={`location-btn ${coords ? 'shared' : ''}`} onClick={shareLocation} disabled={locBusy}>{coords ? '✓ Approximate location attached' : locBusy ? 'Finding your location…' : '＋ Share approximate location'}</button>{locError && <div className="location-error">{locError}</div>}{error && <div className="auth-error">{error}</div>}<button className="primary-btn wide" disabled={!message.trim() || busy} onClick={send}>{busy ? 'Sending…' : 'Contact owner privately'} <span>→</span></button><small>Your contact details stay hidden. Location is shared only if you choose it.</small></div>}<p className="scan-foot">Powered by <strong>reunite</strong> · privacy first</p></main></div>
}

function InboxPage({ inbox, error, reload, go, supabase }) {
  const [selected, setSelected] = useState(inbox[0] || null); const [reply, setReply] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!selected && inbox[0]) setSelected(inbox[0]) }, [inbox, selected])
  const send = async () => { if (!reply.trim() || !selected) return; setBusy(true); await supabase.from('messages').insert({ conversation_id: selected.id, sender_role: 'owner', body: reply.trim() }); setReply(''); await reload(); setBusy(false) }
  return <Shell go={go}><main className="page inbox-page"><div className="eyebrow">PRIVATE INBOX</div><div className="section-heading"><div><h3>Finder messages</h3><p className="lead">Reply without revealing your personal contact details.</p></div><button className="outline-btn" onClick={reload}>Refresh</button></div>{error && <div className="auth-error">{error}</div>}<div className="inbox-layout"><aside className="conversation-list">{inbox.length ? inbox.map(c => <button className={`conversation ${selected?.id === c.id ? 'active' : ''}`} onClick={() => setSelected(c)} key={c.id}><strong>{c.pets?.name || 'Your pet'}</strong><span>{new Date(c.created_at).toLocaleString()}</span><p>{c.messages?.[c.messages.length - 1]?.body || 'New message'}</p></button>) : <div className="empty-state">No finder messages yet.<br /><small>Messages sent from your pet’s QR page will appear here.</small></div>}</aside><section className="conversation-view">{selected ? <><div className="conversation-head"><div className="eyebrow">CONVERSATION</div><h3>{selected.pets?.name || 'Your pet'}</h3></div><div className="message-thread">{(selected.messages || []).sort((a,b) => new Date(a.created_at)-new Date(b.created_at)).map(m => <div className={`thread-message ${m.sender_role}`} key={m.id}><span>{m.sender_role === 'finder' ? 'Finder' : 'You'}</span><p>{m.body}</p>{m.location_lat && m.location_lng && <a className="location-link" href={`https://www.google.com/maps?q=${m.location_lat},${m.location_lng}`} target="_blank" rel="noreferrer">View approximate finder location →</a>}<small>{new Date(m.created_at).toLocaleString()}</small></div>)}</div><div className="reply-box"><textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply…" maxLength="2000" /><button className="primary-btn" onClick={send} disabled={!reply.trim() || busy}>{busy ? 'Sending…' : 'Reply'}</button></div></> : <div className="empty-state">Select a conversation to read and reply.</div>}</section></div></main></Shell>
}

createRoot(document.getElementById('root')).render(<App />)
