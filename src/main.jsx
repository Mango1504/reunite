import React, { useEffect, useMemo, useRef, useState } from 'react'
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

function loadPets() {
  try {
    const saved = JSON.parse(localStorage.getItem('reunite-pets'))
    return Array.isArray(saved) && saved.length ? saved : [loadPet()]
  } catch { return [seedPet] }
}

function App() {
  const [pets, setPets] = useState(loadPets)
  const [pet, setPet] = useState(() => pets[0] || seedPet)
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
  const [qrBusy, setQrBusy] = useState(false)
  const [qrError, setQrError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [profileDirty, setProfileDirty] = useState(false)
  const notify = (type, text) => setFeedback({ type, text, id: Date.now() })

  useEffect(() => {
    localStorage.setItem('reunite-pet', JSON.stringify(pet))
    if (!isCloudMode) localStorage.setItem('reunite-pets', JSON.stringify(pets))
  }, [pet, pets])
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
      supabase.rpc('mark_public_messages_seen', { p_token: token })
    }
  }, [screen])
  useEffect(() => {
    const onHash = () => setScreen(location.hash.startsWith('#/pet/') ? 'scan' : 'home')
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const publicUrl = `${location.origin}${location.pathname}#/pet/${pet.id}`
  const go = (next) => { if (screen === 'edit' && profileDirty && next !== 'edit' && !window.confirm('You have unsaved changes. Leave without saving?')) return; if (next === 'scan') location.hash = `/pet/${pet.id}`; else { history.replaceState(null, '', location.pathname); setScreen(next) } }

  async function loadCloudPet(ownerId) {
    const { data, error } = await supabase.from('pets').select('*').eq('owner_id', ownerId).order('created_at')
    if (!error && data?.length) {
      const cloudPets = data.map(row => ({ ...row, id: row.public_token, _dbId: row.id, photo: row.photo_url || '🐕', publicPhoto: row.public_photo, publicNote: row.public_note }))
      setPets(cloudPets)
      setPet(current => cloudPets.find(item => item._dbId === current._dbId) || cloudPets[0])
    }
    if (!error && data?.length === 0) {
      const { data: created, error: createError } = await supabase.from('pets').insert({ owner_id: ownerId, name: seedPet.name, species: seedPet.species, breed: seedPet.breed, age: seedPet.age, note: seedPet.note, public_photo: true, public_note: true, missing: false }).select().single()
      if (!createError && created) { const firstPet = { ...created, id: created.public_token, _dbId: created.id, photo: created.photo_url || '🐕', publicPhoto: created.public_photo, publicNote: created.public_note }; setPets([firstPet]); setPet(firstPet) }
      if (createError) setAuthError(createError.message)
    }
  }
  async function loadInbox(ownerId = cloudUser?.id) {
    if (!supabase || !ownerId) return
    const { data, error } = await supabase.from('conversations').select('id, pet_id, created_at, expires_at, pets(name), messages(id, sender_role, body, created_at, delivered_at, seen_at, location_lat, location_lng, location_accuracy)').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
    if (error) setInboxError(error.message); else setInbox(data || [])
  }
  useEffect(() => {
    if (!supabase || !cloudUser) return undefined
    const channel = supabase.channel(`owner-inbox-${cloudUser.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => loadInbox(cloudUser.id))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [cloudUser?.id])
  const selectPet = (nextPet) => { setPet(nextPet); setSaved(false); setProfileDirty(false); if (screen === 'scan') location.hash = `/pet/${nextPet.id}` }
  const createPet = async () => {
    if (!supabase || !cloudUser) {
      const nextPet = { ...seedPet, id: `pet_${crypto.randomUUID().slice(0, 8)}`, name: 'New pet', breed: '', age: '' }
      setPets(current => [...current, nextPet]); setPet(nextPet); setProfileDirty(false); setScreen('edit'); return
    }
    const { data, error } = await supabase.from('pets').insert({ owner_id: cloudUser.id, name: 'New pet', species: 'Dog', breed: '', age: '', note: '', public_photo: true, public_note: true, missing: false }).select().single()
    if (error) { setAuthError(error.message); notify('error', 'The pet profile could not be created.'); return }
    const nextPet = { ...data, id: data.public_token, _dbId: data.id, photo: '🐕', publicPhoto: data.public_photo, publicNote: data.public_note }
    setPets(current => [...current, nextPet]); setPet(nextPet); setProfileDirty(false); setScreen('edit'); notify('success', 'Pet profile created.')
  }
  const update = (key, value) => { setPet(current => ({ ...current, [key]: value })); setSaved(false); setProfileDirty(true) }
  const saveProfile = async () => {
    if (supabase && cloudUser) {
      const payload = { owner_id: cloudUser.id, name: pet.name, species: pet.species, breed: pet.breed, age: pet.age, note: pet.note, public_photo: pet.publicPhoto, public_note: pet.publicNote, missing: pet.missing, photo_url: pet.photo_url || null }
      const query = pet._dbId ? supabase.from('pets').update(payload).eq('id', pet._dbId).select().single() : supabase.from('pets').insert(payload).select().single()
      const { data, error } = await query
      if (error) { setAuthError(error.message); notify('error', 'Your profile could not be saved.'); return }
      const updated = { ...data, id: data.public_token, _dbId: data.id, photo: data.photo_url || pet.photo || '🐕', publicPhoto: data.public_photo, publicNote: data.public_note }
      setPet(updated); setPets(current => current.map(item => item._dbId === updated._dbId ? updated : item))
    } else {
      setPets(current => current.map(item => item.id === pet.id ? pet : item))
    }
    localStorage.setItem('reunite-pet', JSON.stringify(pet)); setSaved(true); setProfileDirty(false); notify('success', 'Pet profile saved.')
  }
  const toggleMissing = async () => {
    const updated = { ...pet, missing: !pet.missing }
    setPet(updated); setPets(current => current.map(item => (item._dbId || item.id) === (pet._dbId || pet.id) ? updated : item))
    localStorage.setItem('reunite-pet', JSON.stringify(updated)); localStorage.setItem('reunite-pets', JSON.stringify(pets.map(item => (item._dbId || item.id) === (pet._dbId || pet.id) ? updated : item)))
    if (supabase && cloudUser && pet._dbId) {
      const { error } = await supabase.from('pets').update({ missing: updated.missing }).eq('id', pet._dbId)
      if (error) { setAuthError(error.message); notify('error', 'Missing status could not be updated.') }
      else notify('success', updated.missing ? 'Marked as missing.' : 'Marked as safe.')
    } else {
      notify('success', updated.missing ? 'Marked as missing.' : 'Marked as safe.')
    }
  }
  const authenticate = async (mode, email, password) => {
    setAuthBusy(true); setAuthError('')
    const result = mode === 'signup' ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password })
    if (result.error) setAuthError(result.error.message)
    else if (mode === 'signup' && !result.data.session) setAuthError('Check your email to confirm your account, then sign in.')
    setAuthBusy(false)
  }
  const sendPasswordReset = async email => {
    setAuthBusy(true); setAuthError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}#auth` })
    if (error) setAuthError(error.message)
    else setAuthError('Password reset instructions sent. Check your email.')
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
    const safeFile = await prepareImage(file)
    const extension = 'jpg'
    const previousUrl = pet.photo_url
    const path = `${cloudUser.id}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage.from('reunite-media').upload(path, safeFile, { contentType: 'image/jpeg', upsert: false })
    if (error) { setAuthError(error.message); notify('error', 'The photo could not be uploaded.'); return }
    const { data } = supabase.storage.from('reunite-media').getPublicUrl(path)
    const { error: updateError } = await supabase.from('pets').update({ photo_url: data.publicUrl }).eq('id', pet._dbId)
    if (updateError) { setAuthError(updateError.message); notify('error', 'The photo could not be saved.'); } else {
      if (previousUrl?.includes('/storage/v1/object/public/reunite-media/')) {
        const oldPath = decodeURIComponent(previousUrl.split('/storage/v1/object/public/reunite-media/')[1])
        await supabase.storage.from('reunite-media').remove([oldPath])
      }
      setPet(current => ({ ...current, photo_url: data.publicUrl, photo: data.publicUrl })); setAuthError(''); notify('success', 'Pet photo updated.')
    }
  }
  const deletePet = async () => {
    if (pets.length <= 1) { setAuthError('Keep at least one pet profile in your account.'); return }
    if (supabase && cloudUser && pet._dbId) {
      const { error } = await supabase.rpc('delete_my_reunite_pet', { p_pet_id: pet._dbId })
      if (error) { setAuthError(error.message); notify('error', 'The profile could not be deleted.'); return }
    }
    const remaining = pets.filter(item => (item._dbId || item.id) !== (pet._dbId || pet.id))
    setPets(remaining); setPet(remaining[0]); setSaved(false); setAuthError(''); localStorage.setItem('reunite-pets', JSON.stringify(remaining)); localStorage.setItem('reunite-pet', JSON.stringify(remaining[0])); go('home'); notify('success', 'Pet profile deleted.')
  }
  const regenerateQr = async () => {
    if (!window.confirm(`Replace ${pet.name}'s QR code? The current QR code and link will stop working.`)) return
    setQrBusy(true); setQrError('')
    const fallbackToken = () => `pet_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    let nextToken = null
    if (supabase && cloudUser && pet._dbId) {
      const { data, error } = await supabase.rpc('regenerate_pet_qr', { p_pet_id: pet._dbId })
      if (!error && data) nextToken = data
      if (error && !/regenerate_pet_qr|schema cache|PGRST202/i.test(error.message || '')) { setQrError(error.message); setQrBusy(false); return }
      if (!nextToken) {
        nextToken = fallbackToken()
        const { error: updateError } = await supabase.from('pets').update({ public_token: nextToken }).eq('id', pet._dbId).eq('owner_id', cloudUser.id)
        if (updateError) { setQrError(updateError.message); setQrBusy(false); return }
      }
    } else {
      nextToken = fallbackToken()
    }
    const updated = { ...pet, id: nextToken, public_token: nextToken }
    setPet(updated); setPets(current => current.map(item => (item._dbId || item.id) === (pet._dbId || pet.id) ? updated : item))
    localStorage.setItem('reunite-pet', JSON.stringify(updated)); localStorage.setItem('reunite-pets', JSON.stringify(pets.map(item => (item._dbId || item.id) === (pet._dbId || pet.id) ? updated : item)))
    setQrBusy(false); notify('success', 'New QR ready. The old one no longer works.')
  }
  const openInbox = async () => { await loadInbox(); go('inbox') }
  const sendFinderMessage = async ({ body, coords, conversationId }) => {
    if (!supabase) return { data: null, error: new Error('Messaging is unavailable in demo mode.') }
    const token = location.hash.replace(/^#\/pet\//, '')
    const fn = conversationId ? 'send_public_reply' : 'send_public_message'
    const args = conversationId
      ? { p_token: token, p_conversation: conversationId, p_body: body, p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null, p_accuracy: coords?.accuracy ?? null }
      : { p_token: token, p_body: body, p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null, p_accuracy: coords?.accuracy ?? null }
    const result = await supabase.rpc(fn, args)
    if (!conversationId && !result.error && Array.isArray(result.data)) return { ...result, data: result.data[0]?.send_public_message || result.data[0] || null }
    return result
  }
  const reportPet = async reason => {
    if (!supabase) return new Error('Reporting is unavailable in demo mode.')
    const token = location.hash.replace(/^#\/pet\//, '')
    const { error } = await supabase.rpc('report_public_pet', { p_token: token, p_reason: reason })
    return error || null
  }

  if (screen === 'scan') return <ScanPageRealtime pet={pet} message={message} setMessage={setMessage} sent={sent} setSent={setSent} sendFinderMessage={sendFinderMessage} reportPet={reportPet} />
  if (screen === 'privacy') return <PrivacyPage go={go} />
  if (screen === 'terms') return <TermsPage go={go} />
  if (isProductionMisconfigured) return <ConfigurationErrorPage />
  if (isCloudMode && cloudUser && needsPassword) return <SetPasswordPage submit={setInvitePassword} busy={authBusy} error={authError} />
  if (isCloudMode && !cloudUser && screen !== 'auth') return <LandingPage go={go} />
  if (isCloudMode && !cloudUser) return <AuthPage authenticate={authenticate} sendPasswordReset={sendPasswordReset} busy={authBusy} error={authError} />
  if (screen === 'inbox') return <InboxPageWithTicks inbox={inbox} error={inboxError} reload={loadInbox} go={go} supabase={supabase} feedback={feedback} dismissFeedback={() => setFeedback(null)} />
  if (screen === 'edit') return <EditPage pet={pet} pets={pets} selectPet={selectPet} createPet={createPet} update={update} saveProfile={saveProfile} saved={saved} go={go} deletePet={deletePet} uploadPhoto={uploadPhoto} feedback={feedback} dismissFeedback={() => setFeedback(null)} />
  return <Dashboard pet={pet} pets={pets} selectPet={selectPet} createPet={createPet} toggleMissing={toggleMissing} publicUrl={publicUrl} go={go} cloudUser={cloudUser} signOut={signOut} cloudMode={isCloudMode} openInbox={openInbox} inboxCount={inbox.length} regenerateQr={regenerateQr} qrBusy={qrBusy} qrError={qrError} feedback={feedback} dismissFeedback={() => setFeedback(null)} />
}

const isProductionMisconfigured = import.meta.env.PROD && !supabase

function isAuthCallback() {
  const hash = decodeURIComponent(window.location.hash || '')
  return /(?:^|[&#?])type=(?:invite|recovery)(?:&|$)/i.test(hash)
}

function LandingPage({ go }) {
  return <div className="landing-page"><header className="landing-nav"><div className="landing-brand"><span className="brand-mark">L</span><span>Leo Reunite</span></div><button className="outline-btn" onClick={() => go('auth')}>Sign in</button></header><main className="landing-main"><div className="landing-kicker">PRIVATE PET IDENTITY</div><h1>A safer way<br /><em>home.</em></h1><p className="landing-lead">Give your pet a secure digital identity that helps a finder reach you without exposing your personal details.</p><div className="landing-actions"><button className="primary-btn" onClick={() => go('auth')}>Create your pet profile <span>→</span></button><span>Free to get started</span></div><section className="landing-features"><article><span>01</span><h2>One simple scan</h2><p>A QR code opens a calm, private contact page for your pet.</p></article><article><span>02</span><h2>Private by design</h2><p>Finders can message you without seeing your email or phone number.</p></article><article><span>03</span><h2>Ready when needed</h2><p>Keep their photo, safety note, and missing status in one place.</p></article></section></main><footer className="landing-footer">Leo Reunite · A safer way home · <button onClick={() => go('privacy')}>Privacy</button> · <button onClick={() => go('terms')}>Terms</button></footer></div>
}

function ConfigurationErrorPage() {
  return <div className="auth-page"><div className="scan-brand"><span className="brand-mark">L</span> Leo Reunite</div><main className="auth-card"><div className="eyebrow">TEMPORARILY UNAVAILABLE</div><h1>Leo Reunite is setting up.</h1><p>The secure production connection is not configured yet. Please try again shortly.</p><small>Owners’ data is never stored in demo mode on the public site.</small></main></div>
}

function PublicTextPage({ go, title, eyebrow, children }) {
  return <div className="landing-page"><header className="landing-nav"><button className="brand" onClick={() => go('home')}><span className="brand-mark">L</span><span>Leo Reunite</span></button><button className="outline-btn" onClick={() => go('home')}>Back home</button></header><main className="legal-page"><div className="landing-kicker">{eyebrow}</div><h1>{title}</h1>{children}</main><footer className="landing-footer">Leo Reunite · A safer way home</footer></div>
}

function PrivacyPage({ go }) {
  return <PublicTextPage go={go} title="Privacy, plainly." eyebrow="PRIVACY"><p>Leo Reunite stores the pet information you choose to provide so a finder can reach you through a private profile.</p><h2>What finders can see</h2><p>Only the fields you enable—such as a photo, breed, age, and safety note—appear on the public QR page. Your email and account details stay private.</p><h2>Messages and location</h2><p>Finder messages are delivered to your private inbox. Approximate location is shared only when the finder chooses it. Conversations are retained for up to 30 days to support reunion.</p><h2>Your control</h2><p>You can update or delete pet profiles and rotate QR links. To request help with your data, contact Leo Reunite through the support channel provided with your account.</p><p className="legal-note">This starter policy should be reviewed and adapted to your operating country before launch.</p></PublicTextPage>
}

function TermsPage({ go }) {
  return <PublicTextPage go={go} title="Simple, safe use." eyebrow="TERMS"><p>Leo Reunite helps pet owners share a private contact route when a pet is found. It is not an emergency service or a guarantee that a pet will be recovered.</p><h2>Use responsibly</h2><p>Only upload information and photos you have the right to share. Do not use the service to harass, impersonate, threaten, or expose another person.</p><h2>Finder safety</h2><p>Meet in public places, avoid sharing sensitive personal information, and contact local authorities or animal services when appropriate.</p><h2>Availability</h2><p>We work to keep Leo Reunite available, but online services can experience outages. Keep a physical tag or local emergency contact as a backup.</p><p className="legal-note">These starter terms should be reviewed by a qualified professional before public launch.</p></PublicTextPage>
}

function Shell({ children, go, inboxCount = 0, feedback, dismissFeedback }) {
  return <div className="app-shell"><header className="topbar"><button className="brand" onClick={() => go('home')}><span className="brand-mark">L</span><span>Leo Reunite</span></button><nav><button onClick={() => go('home')}>Dashboard</button><button className="inbox-nav" onClick={() => go('inbox')}>Inbox{inboxCount ? <b>{inboxCount}</b> : null}</button><button onClick={() => go('edit')}>Pet profile</button><span className="avatar">RD</span></nav></header><FeedbackToast feedback={feedback} onDismiss={dismissFeedback} />{children}</div>
}

function FeedbackToast({ feedback, onDismiss }) {
  useEffect(() => {
    if (!feedback) return undefined
    const timer = setTimeout(onDismiss, 3500)
    return () => clearTimeout(timer)
  }, [feedback, onDismiss])
  if (!feedback) return null
  return <div className={`feedback-toast ${feedback.type}`} role="status" aria-live="polite"><span className="feedback-icon">{feedback.type === 'success' ? '✓' : '×'}</span><span>{feedback.text}</span><button type="button" onClick={onDismiss} aria-label="Dismiss notification">×</button></div>
}

function PetVisual({ photo, name, className }) {
  return <span className={className}>{typeof photo === 'string' && photo.startsWith('http') ? <img src={photo} alt={`${name} profile`} /> : photo}</span>
}

async function prepareImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file)
    const max = 1600
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .86))
    bitmap.close()
    return blob || file
  } catch { return file }
}

function Dashboard({ pet, pets, selectPet, createPet, toggleMissing, publicUrl, go, cloudUser, signOut, inboxCount, regenerateQr, qrBusy, qrError, feedback, dismissFeedback }) {
  const [flipped, setFlipped] = useState(false)
  const cardRef = useRef(null)
  useEffect(() => {
    if (!flipped) return undefined
    const closeOnOutsideClick = event => { if (cardRef.current && !cardRef.current.contains(event.target)) setFlipped(false) }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [flipped])
  return <Shell go={go} inboxCount={inboxCount} feedback={feedback} dismissFeedback={dismissFeedback}><main className="dashboard page"><section className="pet-switcher"><div className="pet-avatar-list">{pets.map(item => <button key={item._dbId || item.id} className={`pet-avatar-choice ${(item._dbId || item.id) === (pet._dbId || pet.id) ? 'selected' : ''}`} onClick={() => selectPet(item)}><PetVisual photo={item.photo} name={item.name} className="pet-picker-avatar" /><span>{item.name}</span></button>)}<button className="pet-avatar-choice add-avatar" onClick={createPet}><span className="pet-picker-avatar">＋</span><span>Create</span></button></div></section><section className="dashboard-grid"><article ref={cardRef} className={`pet-card flip-card ${flipped ? 'is-flipped' : ''}`}><div className="flip-card-inner"><section className="flip-face flip-front"><div className="pet-card-top"><PetVisual photo={pet.photo} name={pet.name} className="pet-avatar" /><div><div className="card-label">YOUR PET</div><h2>{pet.name}</h2><p>{pet.breed} · {pet.age}</p></div><button className="icon-btn" onClick={() => go('edit')} aria-label="Edit profile">↗</button></div>{pet.missing && <div className="missing-status">● Marked missing · finder contact is on</div>}<div className="finder-preview"><div className="card-label">FINDER SEES</div><p>{pet.publicPhoto ? 'Photo' : 'No photo'} · {pet.breed || 'Pet details'} · {pet.age || 'Age hidden'}{pet.publicNote && pet.note ? ` · ${pet.note}` : ''}</p></div><div className="privacy-row"><button className={`missing-toggle ${pet.missing ? 'active' : ''}`} onClick={toggleMissing}>{pet.missing ? '✓ Marked missing' : 'Mark as missing'}</button><button className="flip-hint" onClick={() => setFlipped(true)}>Show QR <span>↻</span></button></div></section><section className="flip-face flip-back"><QRCodePanel publicUrl={publicUrl} regenerateQr={regenerateQr} qrBusy={qrBusy} qrError={qrError} /><button className="flip-back-btn" onClick={() => setFlipped(false)}>← Back to profile</button></section></div></article></section><div className="dashboard-footer"><p>A safer way home.</p>{cloudUser && <button className="signout-btn" onClick={signOut}>Sign out</button>}</div></main></Shell>
}

function AuthPage({ authenticate, sendPasswordReset, busy, error }) {
  const [mode, setMode] = useState('signin'); const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  return <div className="auth-page"><div className="scan-brand"><span className="brand-mark">L</span> Leo Reunite</div><main className="auth-card"><div className="eyebrow">PRIVATE PET IDENTITY</div><h1>{mode === 'signin' ? 'Welcome back.' : 'Make a safe home.'}</h1><p>Sign in to manage your pet profile and keep it available wherever you are.</p><form onSubmit={e => { e.preventDefault(); authenticate(mode, email, password) }}><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" minLength="6" value={password} onChange={e => setPassword(e.target.value)} required /></label>{error && <div className="auth-error">{error}</div>}<button className="primary-btn wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} <span>→</span></button></form>{mode === 'signin' && <button className="auth-toggle" disabled={busy} onClick={() => sendPasswordReset(email)}>Forgot password?</button>}<button className="auth-toggle" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); }}> {mode === 'signin' ? 'Create a new account' : 'Already have an account? Sign in'} </button><small>Your pet profile is stored in your Leo Reunite account.</small></main></div>
}

function SetPasswordPage({ submit, busy, error }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = confirm.length > 0 && password !== confirm
  return <div className="auth-page"><div className="scan-brand"><span className="brand-mark">L</span> Leo Reunite</div><main className="auth-card"><div className="eyebrow">ACCOUNT ACTIVATION</div><h1>Set your password.</h1><p>Your invitation worked. Choose a password to finish setting up your Leo Reunite account.</p><form onSubmit={e => { e.preventDefault(); if (!mismatch) submit(password) }}><label>Password<input type="password" minLength="6" value={password} onChange={e => setPassword(e.target.value)} required /></label><label>Confirm password<input type="password" minLength="6" value={confirm} onChange={e => setConfirm(e.target.value)} required /></label>{mismatch && <div className="auth-error">The passwords do not match.</div>}{error && <div className="auth-error">{error}</div>}<button className="primary-btn wide" disabled={busy || mismatch}>{busy ? 'Saving…' : 'Finish account setup'} <span>→</span></button></form><small>Use at least 6 characters. Never share your password.</small></main></div>
}

function QRCodePanel({ publicUrl, regenerateQr, qrBusy, qrError }) {
  const [data, setData] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { QRCode.toDataURL(publicUrl, { width: 220, margin: 1, color: { dark: '#20211f', light: '#ffffff' } }).then(setData) }, [publicUrl])
  const copyLink = async () => { await navigator.clipboard?.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2200) }
  return <div className="qr-face-content"><div className="card-label">YOUR LEO REUNITE QR</div>{data ? <img className="qr" src={data} alt="QR code for the pet profile" /> : <div className="qr-placeholder">Generating…</div>}<p>Scan to view {publicUrl.includes('pet_') ? 'a safe contact page' : 'profile'}</p><div className="qr-actions"><a className="outline-btn" href={data} download="leo-reunite-pet-qr.png">Download QR</a><button className="outline-btn" onClick={copyLink}>{copied ? 'Copied ✓' : 'Copy link'}</button></div><button className="replace-qr-btn" type="button" onClick={regenerateQr} disabled={qrBusy}>{qrBusy ? 'Replacing QR…' : 'Replace QR'}</button>{qrError && <div className="qr-error">{qrError}</div>}</div>
}

function QRCard({ publicUrl }) { return <article className="qr-card"><QRCodePanel publicUrl={publicUrl} /></article> }

function Step({ n, title, text }) { return <div className="step"><span>{n}</span><div><h4>{title}</h4><p>{text}</p></div></div> }

function EditPage({ pet, pets, selectPet, createPet, update, saveProfile, saved, go, uploadPhoto, deletePet, feedback, dismissFeedback }) {
  return <Shell go={go} feedback={feedback} dismissFeedback={dismissFeedback}><main className="page edit-page"><button className="back-btn" onClick={() => go('home')}>← Back to dashboard</button><div className="eyebrow">PET PROFILE</div><h1>Tell their story.</h1><p className="lead">Only the information you choose to share will appear when someone scans the QR.</p><div className="edit-pet-toolbar"><select value={pet._dbId || pet.id || ''} onChange={e => selectPet(pets.find(item => (item._dbId || item.id) === e.target.value) || pet)}>{pets.map(item => <option key={item._dbId || item.id} value={item._dbId || item.id}>{item.name}</option>)}</select><button className="outline-btn" type="button" onClick={createPet}>＋ Add pet</button></div><form onSubmit={e => { e.preventDefault(); saveProfile() }}><div className="photo-upload"><div className="photo-preview">{typeof pet.photo === 'string' && pet.photo.startsWith('http') ? <img src={pet.photo} alt={`${pet.name} profile`} /> : pet.photo}</div><div><label>Pet photo<input type="file" accept="image/*" onChange={e => uploadPhoto(e.target.files?.[0])} /></label><small>JPG, PNG or WEBP · max 5 MB</small></div></div><div className="form-grid"><label>Pet name<input value={pet.name} onChange={e => update('name', e.target.value)} required /></label><label>Breed<input value={pet.breed} onChange={e => update('breed', e.target.value)} required /></label><label>Species<select value={pet.species} onChange={e => update('species', e.target.value)}><option>Dog</option><option>Cat</option><option>Other</option></select></label><label>Age<input value={pet.age} onChange={e => update('age', e.target.value)} /></label></div><label>Safety note<textarea value={pet.note} onChange={e => update('note', e.target.value)} placeholder="Anything a finder should know?" /></label><div className="visibility"><div><h3>Public profile</h3><p>These settings control what a finder can see.</p></div><label className="switch-row"><input type="checkbox" checked={pet.publicPhoto} onChange={e => update('publicPhoto', e.target.checked)} /><span>Pet photo</span></label><label className="switch-row"><input type="checkbox" checked={pet.publicNote} onChange={e => update('publicNote', e.target.checked)} /><span>Safety note</span></label><label className="switch-row"><input type="checkbox" checked={pet.missing} onChange={e => update('missing', e.target.checked)} /><span>Mark missing</span></label></div><div className="form-footer"><span className="private-handle">Owner handle: <strong>@rishabh_reunite</strong> <small>public</small></span><button className="primary-btn" type="submit">{saved ? 'Saved ✓' : 'Save profile'}</button></div></form><div className="data-controls"><div><strong>Remove this profile</strong><p>This removes {pet.name}, their conversations, and uploaded photo from your Leo Reunite account.</p></div><button type="button" className="danger-btn" onClick={() => window.confirm(`Delete ${pet.name}'s profile and conversations? This cannot be undone.`) && deletePet()}>Delete profile</button></div></main></Shell>
}

function ScanPageRealtime({ pet, message, setMessage, sent, setSent, sendFinderMessage, reportPet }) {
  const [messages, setMessages] = useState([]); const [conversationId, setConversationId] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [coords, setCoords] = useState(null); const [reportOpen, setReportOpen] = useState(false); const [reportReason, setReportReason] = useState(''); const [reportStatus, setReportStatus] = useState('')
  const token = location.hash.replace(/^#\/pet\//, '')
  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    const load = async () => { const { data, error: loadError } = await supabase.rpc('get_public_messages_v2', { p_token: token }); if (active && !loadError) { setMessages(data || []); const latest = (data || []).at(-1); if (latest?.id && latest.sender_role === 'finder') setConversationId(current => current || latest.conversation_id); if ((data || []).some(item => item.sender_role === 'owner')) supabase.rpc('mark_public_messages_seen', { p_token: token }) } }
    load()
    const channel = supabase.channel(`pet:${token}`).on('broadcast', { event: 'message' }, ({ payload }) => { const incoming = payload?.record; if (!active || !incoming?.id) return; setMessages(current => current.some(item => item.id === incoming.id) ? current : [...current, incoming].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))); if (incoming.sender_role === 'owner') supabase.rpc('mark_public_messages_seen', { p_token: token }) }).subscribe()
    const timer = window.setInterval(load, 30000)
    return () => { active = false; window.clearInterval(timer); supabase.removeChannel(channel) }
  }, [token])
  const send = async e => { e.preventDefault(); if (!message.trim()) return; setBusy(true); setError(''); const result = await sendFinderMessage({ body: message.trim(), coords, conversationId }); if (result.error) setError(result.error.message); else { setConversationId(current => current || result.data); setMessage(''); setSent(true) } setBusy(false) }
  const report = async e => { e.preventDefault(); const result = await reportPet(reportReason.trim()); setReportStatus(result ? result.message : 'Report received. Thank you.'); if (!result) { setReportReason(''); setReportOpen(false) } }
  const shareLocation = () => navigator.geolocation?.getCurrentPosition(pos => setCoords({ lat: Number(pos.coords.latitude.toFixed(3)), lng: Number(pos.coords.longitude.toFixed(3)), accuracy: pos.coords.accuracy }))
  return <div className="scan-page"><div className="scan-brand"><span className="brand-mark">L</span> Leo Reunite</div><main className="scan-main"><div className="scan-eyebrow"><span className="scan-dot" /> You found a pet profile</div><PetVisual photo={pet.publicPhoto ? pet.photo : '🐾'} name={pet.name} className="scan-pet-avatar" /><h1>Meet {pet.name}.</h1><p className="scan-sub">{pet.publicPhoto ? `${pet.breed} · ${pet.age}` : 'A pet who may need a little help getting home.'}</p>{pet.missing && <div className="missing-banner">This pet has been marked missing. Please contact their person.</div>}{pet.publicNote && <div className="safety-note"><span>✦</span><div><strong>A note from their family</strong><p>{pet.note}</p></div></div>}<div className="owner-card"><div className="owner-initial">L</div><div><div className="card-label">THEIR PERSON</div><strong>Leo Reunite member</strong><p>Contact is private and secure</p></div></div>{sent && <div className="finder-chat"><div className="card-label">PRIVATE CHAT</div><div className="finder-thread">{messages.length ? messages.map((item, index) => <div className={`finder-message ${item.sender_role}`} key={item.id || `${item.created_at}-${index}`}><p>{item.body}</p><small>{item.sender_role === 'owner' ? 'Their person' : 'You'} · {new Date(item.created_at).toLocaleString()}</small></div>) : <p className="finder-waiting">Your message was sent. Waiting for a reply…</p>}</div></div>}<form className="message-box finder-composer" onSubmit={send}><label htmlFor="message">{sent ? 'Continue the conversation' : 'Send a private message'}</label><textarea id="message" value={message} onChange={e => setMessage(e.target.value)} placeholder="Where did you find them?" maxLength="2000" />{coords && <small className="location-attached">✓ Approximate location attached</small>}<div className="finder-compose-actions"><button type="button" className="location-btn" onClick={shareLocation}>＋ Share location</button><button className="primary-btn" disabled={!message.trim() || busy}>{busy ? 'Sending…' : sent ? 'Send message' : 'Contact owner privately'} <span>→</span></button></div>{error && <div className="auth-error">{error}</div>}<small>Your contact details stay hidden. Messages update instantly on both sides.</small></form><div className="report-area">{reportStatus ? <div className="report-success">✓ {reportStatus}</div> : reportOpen ? <form className="report-form" onSubmit={report}><label htmlFor="report-reason">What looks wrong with this profile?</label><textarea id="report-reason" value={reportReason} onChange={e => setReportReason(e.target.value)} maxLength="500" required /><div className="report-actions"><button type="button" className="outline-btn" onClick={() => setReportOpen(false)}>Cancel</button><button className="primary-btn">Send report</button></div></form> : <button type="button" className="text-btn" onClick={() => setReportOpen(true)}>Report this profile</button>}</div><p className="scan-foot">Leo Reunite · <strong>A safer way home</strong></p></main></div>
}

function ScanPage({ pet, message, setMessage, sent, setSent, sendFinderMessage, reportPet }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [coords, setCoords] = useState(null); const [locBusy, setLocBusy] = useState(false); const [locError, setLocError] = useState('')
  const [reportOpen, setReportOpen] = useState(false); const [reportReason, setReportReason] = useState(''); const [reportBusy, setReportBusy] = useState(false); const [reportDone, setReportDone] = useState(false); const [reportError, setReportError] = useState('')
  const [replies, setReplies] = useState([]); const [conversationId, setConversationId] = useState(null)
  useEffect(() => {
    if (!supabase) return undefined
    const token = location.hash.replace(/^#\/pet\//, '')
    let active = true
    const loadReplies = async () => {
      const { data, error: replyError } = await supabase.rpc('get_public_messages', { p_token: token })
      if (active && !replyError) {
        setReplies(data || [])
        if ((data || []).some(item => item.sender_role === 'owner')) supabase.rpc('mark_public_messages_seen', { p_token: token })
      }
    }
    loadReplies()
    const channel = supabase.channel(`pet:${token}`)
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const incoming = payload?.record
        if (!active || !incoming?.id) return
        setReplies(current => current.some(item => item.id === incoming.id) ? current : [...current, incoming].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)))
        if (incoming.sender_role === 'owner') supabase.rpc('mark_public_messages_seen', { p_token: token })
      })
      .subscribe()
    const timer = window.setInterval(loadReplies, 30000)
    return () => { active = false; window.clearInterval(timer); supabase.removeChannel(channel) }
  }, [])
  const shareLocation = () => { setLocBusy(true); setLocError(''); if (!navigator.geolocation) { setLocError('Location is not supported by this browser.'); setLocBusy(false); return } navigator.geolocation.getCurrentPosition(pos => { setCoords({ lat: Number(pos.coords.latitude.toFixed(3)), lng: Number(pos.coords.longitude.toFixed(3)), accuracy: pos.coords.accuracy }); setLocBusy(false) }, () => { setLocError('Location permission was denied. You can still send the message without it.'); setLocBusy(false) }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }) }
  const send = async () => { if (!message.trim()) return; setBusy(true); setError(''); const result = await sendFinderMessage({ body: message.trim(), coords, conversationId }); if (result.error) setError(result.error.message); else { if (!conversationId && result.data) setConversationId(result.data); setMessage(''); setSent(true) } setBusy(false) }
  const submitReport = async e => { e.preventDefault(); if (!reportReason.trim()) return; setReportBusy(true); setReportError(''); const result = await reportPet(reportReason.trim()); if (result) setReportError(result.message || 'We could not send the report. Please try again.'); else { setReportDone(true); setReportReason('') } setReportBusy(false) }
  const ownerReplies = replies.filter(item => item.sender_role === 'owner')
  return <div className="scan-page"><div className="scan-brand"><span className="brand-mark">L</span> Leo Reunite</div><main className="scan-main"><div className="scan-eyebrow"><span className="scan-dot" /> You found a pet profile</div><PetVisual photo={pet.publicPhoto ? pet.photo : '🐾'} name={pet.name} className="scan-pet-avatar" /><h1>Meet {pet.name}.</h1><p className="scan-sub">{pet.publicPhoto ? `${pet.breed} · ${pet.age}` : 'A pet who may need a little help getting home.'}</p>{pet.missing && <div className="missing-banner">This pet has been marked missing. Please contact their person.</div>}{pet.publicNote && <div className="safety-note"><span>✦</span><div><strong>A note from their family</strong><p>{pet.note}</p></div></div>}<div className="owner-card"><div className="owner-initial">L</div><div><div className="card-label">THEIR PERSON</div><strong>Leo Reunite member</strong><p>Contact is private and secure</p></div></div>{sent ? <><div className="sent-state"><span>✓</span><div><strong>Message sent safely</strong><p>Their person will receive your message{coords ? ' and approximate location' : ''} in their Leo Reunite inbox.</p></div></div>{ownerReplies.length > 0 && <div className="finder-replies"><div className="card-label">REPLY FROM THEIR PERSON</div>{ownerReplies.map((item, index) => <div className="finder-reply" key={`${item.created_at}-${index}`}><p>{item.body}</p><small>{new Date(item.created_at).toLocaleString()}</small></div>)}</div>}</> : <div className="message-box"><label htmlFor="message">Send a private message</label><textarea id="message" value={message} onChange={e => setMessage(e.target.value)} placeholder="Where did you find them?" maxLength="2000" /><button type="button" className={`location-btn ${coords ? 'shared' : ''}`} onClick={shareLocation} disabled={locBusy}>{coords ? '✓ Approximate location attached' : locBusy ? 'Finding your location…' : '＋ Share approximate location'}</button>{locError && <div className="location-error">{locError}</div>}{error && <div className="auth-error">{error}</div>}<button className="primary-btn wide" disabled={!message.trim() || busy} onClick={send}>{busy ? 'Sending…' : 'Contact owner privately'} <span>→</span></button><small>Your contact details stay hidden. Location is shared only if you choose it.</small></div>}<div className="report-area">{reportDone ? <div className="report-success">✓ Thanks — your report was received.</div> : reportOpen ? <form className="report-form" onSubmit={submitReport}><label htmlFor="report-reason">What looks wrong with this profile?</label><textarea id="report-reason" value={reportReason} onChange={e => setReportReason(e.target.value)} placeholder="Tell us briefly…" maxLength="500" required />{reportError && <div className="auth-error">{reportError}</div>}<div className="report-actions"><button type="button" className="outline-btn" onClick={() => { setReportOpen(false); setReportError('') }}>Cancel</button><button className="primary-btn" disabled={reportBusy || !reportReason.trim()}>{reportBusy ? 'Sending…' : 'Send report'}</button></div></form> : <button type="button" className="text-btn" onClick={() => setReportOpen(true)}>Report this profile</button>}</div><p className="scan-foot">Leo Reunite · <strong>A safer way home</strong></p></main></div>
}

function InboxPageWithTicks({ inbox, error, reload, go, supabase, feedback, dismissFeedback }) {
  const [selected, setSelected] = useState(inbox[0] || null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState('')
  useEffect(() => { if (!selected && inbox[0]) setSelected(inbox[0]) }, [inbox, selected])
  const send = async () => {
    if (!reply.trim() || !selected) return
    setBusy(true); setSendError('')
    const { error: insertError } = await supabase.from('messages').insert({ conversation_id: selected.id, sender_role: 'owner', body: reply.trim(), delivered_at: new Date().toISOString() })
    if (insertError) { setSendError(insertError.message); setBusy(false); return }
    setReply(''); await reload(); setBusy(false)
  }
  return <Shell go={go} feedback={feedback} dismissFeedback={dismissFeedback}><main className="page inbox-page"><div className="eyebrow">PRIVATE INBOX</div><div className="section-heading"><div><h3>Finder messages</h3><p className="lead">Reply without revealing your personal contact details.</p></div><button className="outline-btn" onClick={reload}>Refresh</button></div>{(error || sendError) && <div className="auth-error">{error || sendError}</div>}<div className="inbox-layout"><aside className="conversation-list">{inbox.length ? inbox.map(c => <button className={`conversation ${selected?.id === c.id ? 'active' : ''}`} onClick={() => setSelected(c)} key={c.id}><strong>{c.pets?.name || 'Your pet'}</strong><span>{new Date(c.created_at).toLocaleString()}</span><p>{c.messages?.[c.messages.length - 1]?.body || 'New message'}</p></button>) : <div className="empty-state">No finder messages yet.<br /><small>Messages sent from your pet’s QR page will appear here.</small></div>}</aside><section className="conversation-view">{selected ? <><div className="conversation-head"><div className="eyebrow">CONVERSATION</div><h3>{selected.pets?.name || 'Your pet'}</h3></div><div className="message-thread">{(selected.messages || []).sort((a,b) => new Date(a.created_at)-new Date(b.created_at)).map(m => <div className={`thread-message ${m.sender_role}`} key={m.id}><div className="message-meta"><span>{m.sender_role === 'finder' ? 'Finder' : 'You'}</span>{m.sender_role === 'owner' && <span className={`message-status ${m.seen_at ? 'seen' : ''}`} aria-label={m.seen_at ? 'Seen' : m.delivered_at ? 'Delivered' : 'Sent'}>{m.seen_at || m.delivered_at ? '✓✓' : '✓'}</span>}</div><p>{m.body}</p>{m.location_lat && m.location_lng && <a className="location-link" href={`https://www.google.com/maps?q=${m.location_lat},${m.location_lng}`} target="_blank" rel="noreferrer">View approximate finder location →</a>}<small>{new Date(m.created_at).toLocaleString()}</small></div>)}</div><div className="reply-box"><textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply…" maxLength={2000} /><button className="primary-btn" onClick={send} disabled={!reply.trim() || busy}>{busy ? 'Sending…' : 'Reply'}</button></div></> : <div className="empty-state">Select a conversation to read and reply.</div>}</section></div></main></Shell>
}

function InboxPage({ inbox, error, reload, go, supabase }) {
  const [selected, setSelected] = useState(inbox[0] || null); const [reply, setReply] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!selected && inbox[0]) setSelected(inbox[0]) }, [inbox, selected])
  const send = async () => { if (!reply.trim() || !selected) return; setBusy(true); await supabase.from('messages').insert({ conversation_id: selected.id, sender_role: 'owner', body: reply.trim(), delivered_at: new Date().toISOString() }); setReply(''); await reload(); setBusy(false) }
  return <Shell go={go}><main className="page inbox-page"><div className="eyebrow">PRIVATE INBOX</div><div className="section-heading"><div><h3>Finder messages</h3><p className="lead">Reply without revealing your personal contact details.</p></div><button className="outline-btn" onClick={reload}>Refresh</button></div>{error && <div className="auth-error">{error}</div>}<div className="inbox-layout"><aside className="conversation-list">{inbox.length ? inbox.map(c => <button className={`conversation ${selected?.id === c.id ? 'active' : ''}`} onClick={() => setSelected(c)} key={c.id}><strong>{c.pets?.name || 'Your pet'}</strong><span>{new Date(c.created_at).toLocaleString()}</span><p>{c.messages?.[c.messages.length - 1]?.body || 'New message'}</p></button>) : <div className="empty-state">No finder messages yet.<br /><small>Messages sent from your pet’s QR page will appear here.</small></div>}</aside><section className="conversation-view">{selected ? <><div className="conversation-head"><div className="eyebrow">CONVERSATION</div><h3>{selected.pets?.name || 'Your pet'}</h3></div><div className="message-thread">{(selected.messages || []).sort((a,b) => new Date(a.created_at)-new Date(b.created_at)).map(m => <div className={`thread-message ${m.sender_role}`} key={m.id}><span>{m.sender_role === 'finder' ? 'Finder' : 'You'}</span><p>{m.body}</p>{m.location_lat && m.location_lng && <a className="location-link" href={`https://www.google.com/maps?q=${m.location_lat},${m.location_lng}`} target="_blank" rel="noreferrer">View approximate finder location →</a>}<small>{new Date(m.created_at).toLocaleString()}</small></div>)}</div><div className="reply-box"><textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply…" maxLength="2000" /><button className="primary-btn" onClick={send} disabled={!reply.trim() || busy}>{busy ? 'Sending…' : 'Reply'}</button></div></> : <div className="empty-state">Select a conversation to read and reply.</div>}</section></div></main></Shell>
}

createRoot(document.getElementById('root')).render(<App />)
