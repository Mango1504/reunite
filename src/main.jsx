import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { isCloudMode, supabase } from './lib/supabase'
import './styles.css'
import './retention.css'
import './boop-theme.css'
import './responsive.css'

const seedPet = {
  id: 'pet_8f4a9c2e', name: 'Milo', breed: 'Golden Retriever', species: 'Dog',
  age: '3 years', photo: '🐕', note: 'Milo is friendly but may be nervous around traffic.',
  publicPhoto: true, publicNote: true, missing: false
}

let qrCodeModulePromise
function loadQrCode() {
  qrCodeModulePromise ||= import('qrcode')
  return qrCodeModulePromise
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

function getFinderDeviceId(token) {
  const key = `leo-reunite-device:${token}`
  try {
    const existing = localStorage.getItem(key)
    if (existing) {
      try {
        const saved = JSON.parse(existing)
        if (saved.id && saved.createdAt && Date.now() - saved.createdAt < 24 * 60 * 60 * 1000) return saved.id
      } catch { if (existing.length >= 16) return existing }
    }
    const created = crypto.randomUUID()
    localStorage.setItem(key, JSON.stringify({ id: created, createdAt: Date.now() }))
    return created
  } catch { return crypto.randomUUID() }
}

function getFinderRoute() {
  const parts = location.hash.replace(/^#\/pet\//, '').split('/').filter(Boolean)
  return { token: parts[0] || '', sessionId: parts[1] || null }
}

const emptyOwnerProfile = { username: '', full_name: '', avatar_url: '', public_avatar: false, public_name: false, bio: '', public_bio: false, city: '', public_city: false, reunion_note: '', public_reunion_note: false }

function loadOwnerProfileLocal() {
  try { return { ...emptyOwnerProfile, ...(JSON.parse(localStorage.getItem('leo-owner-profile')) || {}) } } catch { return emptyOwnerProfile }
}

function saveOwnerProfileLocal(profile) {
  try { localStorage.setItem('leo-owner-profile', JSON.stringify(profile)); window.dispatchEvent(new Event('leo-owner-profile')) } catch {}
}

function notifyOwnerProfileChanged() {
  window.dispatchEvent(new Event('leo-owner-profile'))
}

function clearLocalOwnerCache() {
  try {
    localStorage.removeItem('reunite-pet')
    localStorage.removeItem('reunite-pets')
    localStorage.removeItem('leo-owner-profile')
  } catch {}
}

function getReuniteMediaPath(url) {
  const marker = '/storage/v1/object/public/reunite-media/'
  if (!url?.includes(marker)) return null
  return decodeURIComponent(url.split(marker)[1] || '') || null
}

function ownerInitials(profile) {
  const source = profile?.username || profile?.full_name || 'LR'
  return source.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'LR'
}

function publicOwnerName(profile) {
  return profile?.username ? `@${profile.username}` : 'Leo Reunite member'
}

function App() {
  const [pets, setPets] = useState(() => isCloudMode ? [seedPet] : loadPets())
  const [pet, setPet] = useState(() => pets[0] || seedPet)
  const [screen, setScreen] = useState(location.hash.startsWith('#/pet/') ? 'scan' : 'home')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [saved, setSaved] = useState(false)
  const [cloudUser, setCloudUser] = useState(null)
  const [ownerProfile, setOwnerProfile] = useState(() => isCloudMode ? emptyOwnerProfile : loadOwnerProfileLocal())
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [inbox, setInbox] = useState([])
  const [inboxError, setInboxError] = useState('')
  const [qrBusy, setQrBusy] = useState(false)
  const [qrError, setQrError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [profileDirty, setProfileDirty] = useState(false)
  const notify = (type, text) => setFeedback({ type, text, id: Date.now() })

  useEffect(() => {
    if (isCloudMode) clearLocalOwnerCache()
    else {
      localStorage.setItem('reunite-pet', JSON.stringify(pet))
      localStorage.setItem('reunite-pets', JSON.stringify(pets))
    }
  }, [pet, pets])
  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setCloudUser(data.session?.user ?? null)
      if (data.session?.user && isAuthCallback()) setNeedsPassword(true)
      if (data.session?.user) { await loadCloudPet(data.session.user.id); await loadOwnerProfile(data.session.user.id) }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setCloudUser(session?.user ?? null)
      if (session?.user && (event === 'PASSWORD_RECOVERY' || isAuthCallback())) setNeedsPassword(true)
      if (session?.user) { loadCloudPet(session.user.id); loadOwnerProfile(session.user.id); loadInbox(session.user.id) }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (screen === 'scan' && supabase) {
      const { token } = getFinderRoute()
      supabase.rpc('get_public_pet_v3', { p_token: token }).then(({ data }) => {
        if (data?.[0]) setPet(current => ({ ...current, ...data[0], id: data[0].public_token, publicPhoto: data[0].public_photo, publicNote: data[0].public_note, photo: data[0].photo_url || '🐕' }))
      })
      supabase.rpc('mark_public_messages_seen_v2', { p_token: token, p_device_id: getFinderDeviceId(token) })
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
      const { data: created, error: createError } = await supabase.from('pets').insert({ owner_id: ownerId, name: 'Your pet', species: 'Dog', breed: '', age: '', note: '', public_photo: true, public_note: true, missing: false }).select().single()
      if (!createError && created) { const firstPet = { ...created, id: created.public_token, _dbId: created.id, photo: created.photo_url || '🐕', publicPhoto: created.public_photo, publicNote: created.public_note }; setPets([firstPet]); setPet(firstPet) }
      if (createError) setAuthError(createError.message)
    }
  }
  async function loadOwnerProfile(ownerId) {
    if (!supabase || !ownerId) return
    const { data, error } = await supabase.from('owner_profiles').select('*').eq('id', ownerId).maybeSingle()
    if (error) return
    const profile = { ...emptyOwnerProfile, ...(data || { id: ownerId }) }
    if (!data) {
      const { data: created } = await supabase.from('owner_profiles').upsert({ id: ownerId }).select().single()
      if (created) { setOwnerProfile({ ...emptyOwnerProfile, ...created }); if (!isCloudMode) saveOwnerProfileLocal({ ...emptyOwnerProfile, ...created }); else notifyOwnerProfileChanged(); return }
    }
    setOwnerProfile(profile); if (!isCloudMode) saveOwnerProfileLocal(profile); else notifyOwnerProfileChanged()
  }
  async function saveOwnerProfile(profile) {
    const next = { ...emptyOwnerProfile, ...profile }
    if (supabase && cloudUser) {
      const payload = { ...next, id: cloudUser.id, username: next.username.trim() || null }
      const { data, error } = await supabase.from('owner_profiles').upsert(payload).select().single()
      if (error) { notify('error', 'Your account profile could not be saved.'); return false }
      setOwnerProfile({ ...emptyOwnerProfile, ...data }); notifyOwnerProfileChanged()
    } else {
      setOwnerProfile(next); saveOwnerProfileLocal(next)
    }
    notify('success', 'Account profile saved.')
    return true
  }
  async function loadInbox(ownerId = cloudUser?.id) {
    if (!supabase || !ownerId) return
    const { data, error } = await supabase.from('conversations').select('id, pet_id, created_at, expires_at, blocked_at, request_status, pets(name), messages(id, sender_role, body, created_at, delivered_at, seen_at, location_lat, location_lng, location_accuracy)').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
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
      let photoUrl = pet.photo_url || null
      if (!pet.publicPhoto && photoUrl) {
        const oldPath = getReuniteMediaPath(photoUrl)
        if (oldPath) {
          const { error: removeError } = await supabase.storage.from('reunite-media').remove([oldPath])
          if (removeError) { setAuthError('The photo could not be made private. Please try again.'); notify('error', 'The photo visibility could not be updated.'); return }
          photoUrl = null
        }
      }
      const payload = { owner_id: cloudUser.id, name: pet.name, species: pet.species, breed: pet.breed, age: pet.age, note: pet.note, public_photo: pet.publicPhoto, public_note: pet.publicNote, missing: pet.missing, photo_url: pet.publicPhoto ? photoUrl : null }
      const query = pet._dbId ? supabase.from('pets').update(payload).eq('id', pet._dbId).select().single() : supabase.from('pets').insert(payload).select().single()
      const { data, error } = await query
      if (error) { setAuthError(error.message); notify('error', 'Your profile could not be saved.'); return }
      const updated = { ...data, id: data.public_token, _dbId: data.id, photo: data.photo_url || '🐕', publicPhoto: data.public_photo, publicNote: data.public_note }
      setPet(updated); setPets(current => current.map(item => item._dbId === updated._dbId ? updated : item))
    } else {
      setPets(current => current.map(item => item.id === pet.id ? pet : item))
    }
    if (!isCloudMode) localStorage.setItem('reunite-pet', JSON.stringify(pet)); setSaved(true); setProfileDirty(false); notify('success', 'Pet profile saved.')
  }
  const toggleMissing = async () => {
    const updated = { ...pet, missing: !pet.missing }
    setPet(updated); setPets(current => current.map(item => (item._dbId || item.id) === (pet._dbId || pet.id) ? updated : item))
    if (!isCloudMode) { localStorage.setItem('reunite-pet', JSON.stringify(updated)); localStorage.setItem('reunite-pets', JSON.stringify(pets.map(item => (item._dbId || item.id) === (pet._dbId || pet.id) ? updated : item))) }
    if (supabase && cloudUser && pet._dbId) {
      const { error } = await supabase.from('pets').update({ missing: updated.missing }).eq('id', pet._dbId)
      if (error) { setAuthError(error.message); notify('error', 'Missing status could not be updated.') }
      else notify('success', updated.missing ? 'Marked as missing.' : 'Marked as safe.')
    } else {
      notify('success', updated.missing ? 'Marked as missing.' : 'Marked as safe.')
    }
  }
  const authenticate = async (mode, email, password) => {
    if (password.length < 8) { setAuthError('Use at least 8 characters for your password.'); return }
    setAuthBusy(true); setAuthError(''); setAuthMessage('')
    try {
      const authRedirect = `${location.origin}${location.pathname}`
      const result = mode === 'signup'
        ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirect } })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error) setAuthError(result.error.message)
      else if (mode === 'signup' && !result.data.session) setAuthMessage('Leo Reunite sent an authentication request to your email. Open the confirmation link, then return here to sign in.')
    } catch { setAuthError('We could not reach Leo Reunite. Check your connection and try again.') }
    finally { setAuthBusy(false) }
  }
  const sendPasswordReset = async email => {
    if (!email.trim()) { setAuthError('Enter your email first, then choose Forgot password.'); return }
    setAuthBusy(true); setAuthError(''); setAuthMessage('')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}${location.pathname}#auth` })
      if (error) setAuthError(error.message)
      else setAuthMessage('Password reset instructions sent. Check your email.')
    } catch { setAuthError('We could not reach Leo Reunite. Check your connection and try again.') }
    finally { setAuthBusy(false) }
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
  const signOut = async () => { await supabase?.auth.signOut(); clearLocalOwnerCache(); setCloudUser(null); setPets([seedPet]); setPet(seedPet); setOwnerProfile(emptyOwnerProfile); setInbox([]); setAuthError('') }
  const uploadPhoto = async (file) => {
    if (!file || !supabase || !cloudUser || !pet._dbId) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setAuthError('Please choose a JPG, PNG, or WEBP image.'); return }
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
    setPets(remaining); setPet(remaining[0]); setSaved(false); setAuthError(''); if (!isCloudMode) { localStorage.setItem('reunite-pets', JSON.stringify(remaining)); localStorage.setItem('reunite-pet', JSON.stringify(remaining[0])) } go('home'); notify('success', 'Pet profile deleted.')
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
    if (!isCloudMode) { localStorage.setItem('reunite-pet', JSON.stringify(updated)); localStorage.setItem('reunite-pets', JSON.stringify(pets.map(item => (item._dbId || item.id) === (pet._dbId || pet.id) ? updated : item))) }
    setQrBusy(false); notify('success', 'New QR ready. The old one no longer works.')
  }
  const openInbox = async () => { await loadInbox(); go('inbox') }
  const sendFinderMessage = async ({ body, coords, conversationId, deviceId }) => {
    if (!supabase) return { data: null, error: new Error('Messaging is unavailable in demo mode.') }
    const { token } = getFinderRoute()
    const fn = conversationId ? 'send_public_reply_v2' : 'send_public_message_v2'
    const args = conversationId
      ? { p_token: token, p_device_id: deviceId, p_conversation: conversationId, p_body: body, p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null, p_accuracy: coords?.accuracy ?? null }
      : { p_token: token, p_device_id: deviceId, p_body: body, p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null, p_accuracy: coords?.accuracy ?? null }
    const result = await supabase.rpc(fn, args)
    if (!conversationId && !result.error && Array.isArray(result.data)) return { ...result, data: result.data[0]?.send_public_message || result.data[0] || null }
    return result
  }
  const reportPet = async reason => {
    if (!supabase) return new Error('Reporting is unavailable in demo mode.')
    const { token } = getFinderRoute()
    const { error } = await supabase.rpc('report_public_pet_v2', { p_token: token, p_reason: reason, p_device_id: getFinderDeviceId(token) })
    return error || null
  }

  if (screen === 'scan') return <ScanPageRealtime pet={pet} message={message} setMessage={setMessage} sent={sent} setSent={setSent} sendFinderMessage={sendFinderMessage} reportPet={reportPet} />
  if (screen === 'account') return <OwnerProfilePage profile={ownerProfile} cloudUser={cloudUser} go={go} onProfileChanged={saveOwnerProfile} notify={notify} />
  if (screen === 'privacy') return <PrivacyPage go={go} />
  if (screen === 'terms') return <TermsPage go={go} />
  if (isProductionMisconfigured) return <ConfigurationErrorPage />
  if (isCloudMode && cloudUser && needsPassword) return <SetPasswordPage submit={setInvitePassword} busy={authBusy} error={authError} />
  if (isCloudMode && !cloudUser && screen !== 'auth') return <LandingPage go={go} />
  if (isCloudMode && !cloudUser) return <AuthPage authenticate={authenticate} sendPasswordReset={sendPasswordReset} busy={authBusy} error={authError} message={authMessage} />
  if (screen === 'inbox') return <InboxPageWithRequests inbox={inbox} error={inboxError} reload={loadInbox} go={go} supabase={supabase} feedback={feedback} dismissFeedback={() => setFeedback(null)} />
  if (screen === 'edit') return <EditPage pet={pet} pets={pets} selectPet={selectPet} createPet={createPet} update={update} saveProfile={saveProfile} saved={saved} go={go} deletePet={deletePet} uploadPhoto={uploadPhoto} ownerProfile={ownerProfile} feedback={feedback} dismissFeedback={() => setFeedback(null)} />
  const firstTimeOwner = Boolean(cloudUser && pets.length === 1 && pets[0].name === 'Your pet' && !pets[0].breed)
  return <Dashboard pet={pet} pets={pets} selectPet={selectPet} createPet={createPet} toggleMissing={toggleMissing} publicUrl={publicUrl} go={go} cloudUser={cloudUser} signOut={signOut} cloudMode={isCloudMode} openInbox={openInbox} inboxCount={inbox.length} regenerateQr={regenerateQr} qrBusy={qrBusy} qrError={qrError} firstTimeOwner={firstTimeOwner} feedback={feedback} dismissFeedback={() => setFeedback(null)} />
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
  return <PublicTextPage go={go} title="Privacy, plainly." eyebrow="PRIVACY"><p>Leo Reunite stores the pet information you choose to provide so a finder can reach you through a private profile.</p><h2>What finders can see</h2><p>Only the fields you enable—such as a photo, breed, age, and safety note—appear on the public QR page. Your email and account details stay private.</p><h2>Messages and location</h2><p>Finder messages are delivered to your private inbox. Approximate location is shared only when the finder chooses it. Conversations and finder sessions are automatically erased after 24 hours.</p><h2>Your control</h2><p>You can update or delete pet profiles and rotate QR links. To request help with your data, contact Leo Reunite through the support channel provided with your account.</p><p className="legal-note">This starter policy should be reviewed and adapted to your operating country before launch.</p></PublicTextPage>
}

function TermsPage({ go }) {
  return <PublicTextPage go={go} title="Simple, safe use." eyebrow="TERMS"><p>Leo Reunite helps pet owners share a private contact route when a pet is found. It is not an emergency service or a guarantee that a pet will be recovered.</p><h2>Use responsibly</h2><p>Only upload information and photos you have the right to share. Do not use the service to harass, impersonate, threaten, or expose another person.</p><h2>Finder safety</h2><p>Meet in public places, avoid sharing sensitive personal information, and contact local authorities or animal services when appropriate.</p><h2>Availability</h2><p>We work to keep Leo Reunite available, but online services can experience outages. Keep a physical tag or local emergency contact as a backup.</p><p className="legal-note">These starter terms should be reviewed by a qualified professional before public launch.</p></PublicTextPage>
}

function LegacyShell({ children, go, inboxCount = 0, feedback, dismissFeedback }) {
  const [accountOpen, setAccountOpen] = useState(false)
  const [theme, setTheme] = useState(getSavedTheme)
  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem('leo-theme', theme) } catch {}
    if (theme !== 'auto') return undefined
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const syncSystemTheme = () => applyTheme('auto')
    media?.addEventListener?.('change', syncSystemTheme)
    return () => media?.removeEventListener?.('change', syncSystemTheme)
  }, [theme])
  useEffect(() => {
    if (!accountOpen) return undefined
    const closeOnEscape = event => { if (event.key === 'Escape') setAccountOpen(false) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [accountOpen])
  return <div className="app-shell"><header className="topbar"><button className="brand" onClick={() => go('home')}><span className="brand-mark">L</span><span>Leo Reunite</span></button><nav><button onClick={() => go('home')}>Dashboard</button><button className="inbox-nav" onClick={() => go('inbox')}>Inbox{inboxCount ? <b>{inboxCount}</b> : null}</button><button onClick={() => go('edit')}>Pet profile</button><button className="avatar avatar-button" onClick={() => setAccountOpen(true)} aria-label="Open account menu" aria-expanded={accountOpen}>RD</button></nav></header><AccountDrawer open={accountOpen} close={() => setAccountOpen(false)} go={go} inboxCount={inboxCount} theme={theme} setTheme={setTheme} /><FeedbackToast feedback={feedback} onDismiss={dismissFeedback} />{children}</div>
}

function getSavedTheme() {
  try { return ['light', 'dark', 'auto'].includes(localStorage.getItem('leo-theme')) ? localStorage.getItem('leo-theme') : 'auto' } catch { return 'auto' }
}

function applyTheme(mode) {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  const resolved = mode === 'auto' ? (media?.matches ? 'dark' : 'light') : mode
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

function AccountDrawer({ open, close, go, inboxCount, theme, setTheme }) {
  useEffect(() => {
    if (!open) return undefined
    document.querySelector('.account-drawer .drawer-close')?.focus()
    const closeOnOutside = event => { if (event.target.closest?.('.account-drawer') || event.target.closest?.('.avatar-button')) return; close() }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open, close])
  if (!open) return null
  const navigate = next => { close(); go(next) }
  const logout = async () => { await supabase?.auth.signOut(); clearLocalOwnerCache(); close(); history.replaceState(null, '', location.pathname) }
  return <><div className="drawer-scrim" aria-hidden="true" /><aside className="account-drawer" role="dialog" aria-modal="true" aria-label="Account menu"><div className="drawer-header"><div><div className="eyebrow">ACCOUNT</div><h2>Leo Reunite</h2><p>Your private pet identity</p></div><button className="drawer-close" onClick={close} aria-label="Close account menu">×</button></div><div className="drawer-profile"><span className="drawer-avatar">RD</span><div><strong>Owner account</strong><span>Manage your safe home</span></div></div><div className="drawer-section"><div className="drawer-section-label">QUICK ACCESS</div><button className="drawer-link" onClick={() => navigate('home')}><span>⌂</span><span>Dashboard</span></button><button className="drawer-link" onClick={() => navigate('inbox')}><span>✉</span><span>Inbox{inboxCount ? <b className="drawer-count">{inboxCount}</b> : null}</span><span className="drawer-arrow">›</span></button><button className="drawer-link" onClick={() => navigate('edit')}><span>✎</span><span>Pet profile settings</span><span className="drawer-arrow">›</span></button></div><div className="drawer-section"><div className="drawer-section-label">APPEARANCE</div><div className="theme-picker"><button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}>Light</button><button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}>Dark</button><button className={theme === 'auto' ? 'selected' : ''} onClick={() => setTheme('auto')}>Auto</button></div><small className="drawer-hint">Auto follows your device preference.</small></div><div className="drawer-section drawer-secondary"><button className="drawer-link" onClick={() => navigate('privacy')}><span>⌕</span><span>Privacy</span><span className="drawer-arrow">›</span></button><button className="drawer-link" onClick={() => navigate('terms')}><span>▤</span><span>Terms</span><span className="drawer-arrow">›</span></button></div><div className="drawer-footer"><button className="drawer-logout" onClick={logout}>Log out <span>→</span></button><small>Leo Reunite · A safer way home</small></div></aside></>
}

function OwnerAvatar({ profile, className = '' }) {
  return <span className={`owner-avatar ${className}`}>{profile?.avatar_url ? <img src={profile.avatar_url} alt="Your profile" /> : ownerInitials(profile)}</span>
}

function Shell({ children, go, inboxCount = 0, feedback, dismissFeedback }) {
  const [accountOpen, setAccountOpen] = useState(false)
  const [theme, setTheme] = useState(getSavedTheme)
  const [profile, setProfile] = useState(() => isCloudMode ? emptyOwnerProfile : loadOwnerProfileLocal())
  const avatarTimer = useRef(null)
  const avatarLongPress = useRef(false)
  useEffect(() => {
    const syncProfile = () => setProfile(loadOwnerProfileLocal())
    window.addEventListener('leo-owner-profile', syncProfile)
    return () => window.removeEventListener('leo-owner-profile', syncProfile)
  }, [])
  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem('leo-theme', theme) } catch {}
    if (theme !== 'auto') return undefined
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const syncSystemTheme = () => applyTheme('auto')
    media?.addEventListener?.('change', syncSystemTheme)
    return () => media?.removeEventListener?.('change', syncSystemTheme)
  }, [theme])
  useEffect(() => {
    if (!accountOpen) return undefined
    const closeOnEscape = event => { if (event.key === 'Escape') setAccountOpen(false) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [accountOpen])
  const clearAvatarTimer = () => { if (avatarTimer.current) window.clearTimeout(avatarTimer.current); avatarTimer.current = null }
  const openAvatarMenu = () => {
    if (avatarLongPress.current) { avatarLongPress.current = false; return }
    clearAvatarTimer()
    avatarTimer.current = window.setTimeout(() => setAccountOpen(true), 180)
  }
  const beginLongPress = () => {
    clearAvatarTimer()
    avatarTimer.current = window.setTimeout(() => { avatarLongPress.current = true; setAccountOpen(false); go('account') }, 600)
  }
  const openProfile = () => { clearAvatarTimer(); avatarLongPress.current = true; setAccountOpen(false); go('account') }
  return <div className="app-shell"><header className="topbar"><button className="brand" onClick={() => go('home')}><span className="brand-mark">L</span><span>Leo Reunite</span></button><nav><button onClick={() => go('home')}>Dashboard</button><button className="inbox-nav" onClick={() => go('inbox')}>Inbox{inboxCount ? <b>{inboxCount}</b> : null}</button><button onClick={() => go('edit')}>Pet profile</button><button className="avatar-button" onClick={openAvatarMenu} onDoubleClick={openProfile} onPointerDown={beginLongPress} onPointerUp={clearAvatarTimer} onPointerLeave={clearAvatarTimer} onPointerCancel={clearAvatarTimer} aria-label="Open account menu. Double-click or press and hold to edit profile." aria-expanded={accountOpen}><OwnerAvatar profile={profile} /><span className="avatar-edit" aria-hidden="true">✎</span></button></nav></header><AccountDrawerV2 open={accountOpen} close={() => setAccountOpen(false)} go={go} inboxCount={inboxCount} theme={theme} setTheme={setTheme} profile={profile} /><FeedbackToast feedback={feedback} onDismiss={dismissFeedback} />{children}</div>
}

function AccountDrawerV2({ open, close, go, inboxCount, theme, setTheme, profile }) {
  useEffect(() => {
    if (!open) return undefined
    document.querySelector('.account-drawer .drawer-close')?.focus()
    const closeOnOutside = event => { if (event.target.closest?.('.account-drawer') || event.target.closest?.('.avatar-button')) return; close() }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open, close])
  if (!open) return null
  const navigate = next => { close(); go(next) }
  const logout = async () => { await supabase?.auth.signOut(); clearLocalOwnerCache(); close(); history.replaceState(null, '', location.pathname) }
  return <><div className="drawer-scrim" aria-hidden="true" /><aside className="account-drawer" role="dialog" aria-modal="true" aria-label="Account menu"><div className="drawer-header"><div><div className="eyebrow">ACCOUNT</div><h2>Leo Reunite</h2><p>Your private pet identity</p></div><button className="drawer-close" onClick={close} aria-label="Close account menu">×</button></div><button className="drawer-profile drawer-profile-button" onClick={() => navigate('account')}><OwnerAvatar profile={profile} className="drawer-avatar" /><div><strong>{publicOwnerName(profile)}</strong><span>{profile.full_name || 'Edit your profile'}</span></div><span className="drawer-arrow">›</span></button><div className="drawer-section"><div className="drawer-section-label">QUICK ACCESS</div><button className="drawer-link" onClick={() => navigate('home')}><span>⌂</span><span>Dashboard</span></button><button className="drawer-link" onClick={() => navigate('inbox')}><span>✉</span><span>Inbox{inboxCount ? <b className="drawer-count">{inboxCount}</b> : null}</span><span className="drawer-arrow">›</span></button><button className="drawer-link" onClick={() => navigate('edit')}><span>✎</span><span>Pet profile settings</span><span className="drawer-arrow">›</span></button></div><div className="drawer-section"><div className="drawer-section-label">APPEARANCE</div><div className="theme-picker"><button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}>Light</button><button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}>Dark</button><button className={theme === 'auto' ? 'selected' : ''} onClick={() => setTheme('auto')}>Auto</button></div><small className="drawer-hint">Auto follows your device preference.</small></div><div className="drawer-section drawer-secondary"><button className="drawer-link" onClick={() => navigate('privacy')}><span>⌕</span><span>Privacy</span><span className="drawer-arrow">›</span></button><button className="drawer-link" onClick={() => navigate('terms')}><span>▤</span><span>Terms</span><span className="drawer-arrow">›</span></button></div><div className="drawer-footer"><button className="drawer-logout" onClick={logout}>Log out <span>→</span></button><small>Leo Reunite · A safer way home</small></div></aside></>
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

function Dashboard({ pet, pets, selectPet, createPet, toggleMissing, publicUrl, go, cloudUser, signOut, inboxCount, regenerateQr, qrBusy, qrError, firstTimeOwner, feedback, dismissFeedback }) {
  const [flipped, setFlipped] = useState(false)
  const cardRef = useRef(null)
  useEffect(() => {
    if (!flipped) return undefined
    const closeOnOutsideClick = event => { if (cardRef.current && !cardRef.current.contains(event.target)) setFlipped(false) }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [flipped])
  return <Shell go={go} inboxCount={inboxCount} feedback={feedback} dismissFeedback={dismissFeedback}><main className="dashboard page"><section className="pet-switcher"><div className="pet-avatar-list">{pets.map(item => <button key={item._dbId || item.id} className={`pet-avatar-choice ${(item._dbId || item.id) === (pet._dbId || pet.id) ? 'selected' : ''}`} onClick={() => selectPet(item)}><PetVisual photo={item.photo} name={item.name} className="pet-picker-avatar" /><span>{item.name}</span></button>)}<button className="pet-avatar-choice add-avatar" onClick={createPet}><span className="pet-picker-avatar">＋</span><span>Create</span></button></div></section>{firstTimeOwner && <section className="welcome-card"><div><div className="eyebrow">WELCOME TO LEO REUNITE</div><h2>Let’s make their way home.</h2><p>Your account is ready. Add your pet’s name and one helpful detail, then save to create their private QR identity.</p></div><button className="primary-btn" onClick={() => go('edit')}>Set up your pet <span>→</span></button></section>}<section className="dashboard-grid"><article ref={cardRef} className={`pet-card flip-card ${flipped ? 'is-flipped' : ''}`}><div className="flip-card-inner"><section className="flip-face flip-front"><div className="pet-card-top"><PetVisual photo={pet.photo} name={pet.name} className="pet-avatar" /><div><div className="card-label">YOUR PET</div><h2>{pet.name}</h2><p>{pet.breed || 'Add their details'}{pet.age ? ` · ${pet.age}` : ''}</p></div><button className="icon-btn" onClick={() => go('edit')} aria-label="Edit profile">↗</button></div>{pet.missing && <div className="missing-status">● Marked missing · finder contact is on</div>}<div className="finder-preview"><div className="card-label">FINDER SEES</div><p>{pet.publicPhoto ? 'Photo' : 'No photo'} · {pet.breed || 'Pet details'} · {pet.age || 'Age hidden'}{pet.publicNote && pet.note ? ` · ${pet.note}` : ''}</p></div><div className="privacy-row"><button className={`missing-toggle ${pet.missing ? 'active' : ''}`} onClick={toggleMissing}>{pet.missing ? '✓ Marked missing' : 'Mark as missing'}</button><button className="flip-hint" onClick={() => setFlipped(true)}>Show QR <span>↻</span></button></div></section><section className="flip-face flip-back"><QRCodePanel publicUrl={publicUrl} regenerateQr={regenerateQr} qrBusy={qrBusy} qrError={qrError} /><button className="flip-back-btn" onClick={() => setFlipped(false)}>← Back to profile</button></section></div></article></section><div className="dashboard-footer"><p>A safer way home.</p>{cloudUser && <button className="signout-btn" onClick={signOut}>Sign out</button>}</div></main></Shell>
}

function AuthPage({ authenticate, sendPasswordReset, busy, error, message }) {
  const [mode, setMode] = useState('signin'); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [showPassword, setShowPassword] = useState(false)
  const switchMode = () => setMode(current => current === 'signin' ? 'signup' : 'signin')
  const mismatch = mode === 'signup' && confirm.length > 0 && password !== confirm
  return <div className="auth-page"><div className="scan-brand"><span className="brand-mark">L</span> Leo Reunite</div><main className="auth-card"><div className="eyebrow">PRIVATE PET IDENTITY</div><h1>{mode === 'signin' ? 'Welcome back.' : 'Make a safe home.'}</h1><p>{mode === 'signin' ? 'Sign in with your Leo Reunite account.' : 'Create your private pet identity in a few seconds.'}</p><form onSubmit={e => { e.preventDefault(); if (!mismatch) authenticate(mode, email, password) }}><label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength="8" value={password} onChange={e => setPassword(e.target.value)} required /><button type="button" className="password-toggle" onClick={() => setShowPassword(current => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div></label>{mode === 'signup' && <label>Confirm password<div className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="8" value={confirm} onChange={e => setConfirm(e.target.value)} required /><span className="password-spacer" /></div></label>}{mismatch && <div className="auth-error">The passwords do not match.</div>}{error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-success" role="status">{message}</div>}<small className="password-hint">Use at least 8 characters. Never reuse your password.</small><button className="primary-btn wide" disabled={busy || mismatch}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} <span>→</span></button></form><div className="auth-links">{mode === 'signin' && <button className="auth-toggle" disabled={busy} onClick={() => sendPasswordReset(email)}>Forgot password?</button>}<button className="auth-toggle" disabled={busy} onClick={switchMode}>{mode === 'signin' ? 'Sign up' : 'Sign in'}</button></div></main></div>
}

function SetPasswordPage({ submit, busy, error }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = confirm.length > 0 && password !== confirm
  return <div className="auth-page"><div className="scan-brand"><span className="brand-mark">L</span> Leo Reunite</div><main className="auth-card"><div className="eyebrow">ACCOUNT ACTIVATION</div><h1>Set your password.</h1><p>Your invitation worked. Choose a password to finish setting up your Leo Reunite account.</p><form onSubmit={e => { e.preventDefault(); if (!mismatch && password.length >= 8) submit(password) }}><label>Password<input type="password" autoComplete="new-password" minLength="8" value={password} onChange={e => setPassword(e.target.value)} required /></label><label>Confirm password<input type="password" autoComplete="new-password" minLength="8" value={confirm} onChange={e => setConfirm(e.target.value)} required /></label>{password.length > 0 && password.length < 8 && <div className="auth-error">Use at least 8 characters.</div>}{mismatch && <div className="auth-error">The passwords do not match.</div>}{error && <div className="auth-error">{error}</div>}<button className="primary-btn wide" disabled={busy || mismatch || password.length < 8}>{busy ? 'Saving…' : 'Finish account setup'} <span>→</span></button></form><small>Use at least 8 characters. Never share your password.</small></main></div>
}

function QRCodePanel({ publicUrl, regenerateQr, qrBusy, qrError }) {
  const [data, setData] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let active = true
    setData('')
    loadQrCode().then(module => {
      const QRCode = module.default || module
      return QRCode.toDataURL(publicUrl, { width: 220, margin: 1, color: { dark: '#20211f', light: '#ffffff' } })
    }).then(nextData => { if (active) setData(nextData) }).catch(() => { if (active) setData('') })
    return () => { active = false }
  }, [publicUrl])
  const copyLink = async () => { await navigator.clipboard?.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2200) }
  return <div className="qr-face-content"><div className="card-label">YOUR LEO REUNITE QR</div>{data ? <img className="qr" src={data} alt="QR code for the pet profile" /> : <div className="qr-placeholder">Generating…</div>}<p>Scan to view {publicUrl.includes('pet_') ? 'a safe contact page' : 'profile'}</p><div className="qr-actions"><a className="outline-btn" href={data} download="leo-reunite-pet-qr.png">Download QR</a><button className="outline-btn" onClick={copyLink}>{copied ? 'Copied ✓' : 'Copy link'}</button></div><button className="replace-qr-btn" type="button" onClick={regenerateQr} disabled={qrBusy}>{qrBusy ? 'Replacing QR…' : 'Replace QR'}</button>{qrError && <div className="qr-error">{qrError}</div>}</div>
}

function QRCard({ publicUrl }) { return <article className="qr-card"><QRCodePanel publicUrl={publicUrl} /></article> }

function Step({ n, title, text }) { return <div className="step"><span>{n}</span><div><h4>{title}</h4><p>{text}</p></div></div> }

function OwnerProfilePage({ profile, cloudUser, go, onProfileChanged, feedback, dismissFeedback }) {
  const [draft, setDraft] = useState({ ...emptyOwnerProfile, ...profile })
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft({ ...emptyOwnerProfile, ...profile }), [profile])
  const update = (key, value) => setDraft(current => ({ ...current, [key]: value }))
  const submit = async event => {
    event.preventDefault(); setBusy(true)
    await onProfileChanged(draft)
    setBusy(false)
  }
  return <Shell go={go} feedback={feedback} dismissFeedback={dismissFeedback}><main className="page edit-page account-page"><button className="back-btn" onClick={() => go('home')}>← Back to dashboard</button><div className="eyebrow">ACCOUNT PROFILE</div><h1>Make it yours.</h1><p className="lead">Add a little context so a finder can recognize you and feel safe getting in touch.</p><form onSubmit={submit}><div className="form-grid"><label>Username<input value={draft.username} onChange={e => update('username', e.target.value.replace(/\s/g, ''))} minLength="3" maxLength="32" pattern="[A-Za-z0-9._-]+" placeholder="your_handle" /><small>Letters, numbers, dots, underscores, and hyphens.</small></label><label>Full name<input value={draft.full_name} onChange={e => update('full_name', e.target.value)} maxLength="80" placeholder="Your name" /></label><label>City or region<input value={draft.city} onChange={e => update('city', e.target.value)} maxLength="80" placeholder="Optional" /></label><label>Avatar URL<input type="url" value={draft.avatar_url || ''} onChange={e => update('avatar_url', e.target.value)} placeholder="https://…" /></label></div><label>Short bio<textarea value={draft.bio} onChange={e => update('bio', e.target.value)} maxLength="300" placeholder="A sentence about you or your pets." /></label><label>Reunion note<textarea value={draft.reunion_note} onChange={e => update('reunion_note', e.target.value)} maxLength="300" placeholder="Anything helpful for a safe reunion?" /></label><div className="visibility"><div><h3>Finder visibility</h3><p>Only enabled fields appear on a scanned pet profile.</p></div><label className="switch-row"><input type="checkbox" checked={draft.public_avatar} onChange={e => update('public_avatar', e.target.checked)} /><span>Avatar</span></label><label className="switch-row"><input type="checkbox" checked={draft.public_name} onChange={e => update('public_name', e.target.checked)} /><span>Name</span></label><label className="switch-row"><input type="checkbox" checked={draft.public_bio} onChange={e => update('public_bio', e.target.checked)} /><span>Bio</span></label><label className="switch-row"><input type="checkbox" checked={draft.public_city} onChange={e => update('public_city', e.target.checked)} /><span>City</span></label><label className="switch-row"><input type="checkbox" checked={draft.public_reunion_note} onChange={e => update('public_reunion_note', e.target.checked)} /><span>Reunion note</span></label></div><div className="form-footer"><span className="private-handle">{cloudUser ? 'Synced to your account' : 'Saved in this browser'}</span><button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save account profile'}</button></div></form></main></Shell>
}

function EditPage({ pet, pets, selectPet, createPet, update, saveProfile, saved, go, uploadPhoto, deletePet, ownerProfile, feedback, dismissFeedback }) {
  const ownerHandle = ownerProfile?.username ? `@${ownerProfile.username}` : 'Not set'
  return <Shell go={go} feedback={feedback} dismissFeedback={dismissFeedback}><main className="page edit-page"><button className="back-btn" onClick={() => go('home')}>← Back to dashboard</button><div className="eyebrow">PET PROFILE</div><h1>Tell their story.</h1><p className="lead">Only the information you choose to share will appear when someone scans the QR.</p><div className="edit-pet-toolbar"><select value={pet._dbId || pet.id || ''} onChange={e => selectPet(pets.find(item => (item._dbId || item.id) === e.target.value) || pet)}>{pets.map(item => <option key={item._dbId || item.id} value={item._dbId || item.id}>{item.name}</option>)}</select><button className="outline-btn" type="button" onClick={createPet}>＋ Add pet</button></div><form onSubmit={e => { e.preventDefault(); saveProfile() }}><div className="photo-upload"><div className="photo-preview">{typeof pet.photo === 'string' && pet.photo.startsWith('http') ? <img src={pet.photo} alt={`${pet.name} profile`} /> : pet.photo}</div><div><label>Pet photo<input type="file" accept="image/*" onChange={e => uploadPhoto(e.target.files?.[0])} /></label><small>JPG, PNG or WEBP · max 5 MB</small></div></div><div className="form-grid"><label>Pet name<input value={pet.name} onChange={e => update('name', e.target.value)} required /></label><label>Breed<input value={pet.breed} onChange={e => update('breed', e.target.value)} required /></label><label>Species<select value={pet.species} onChange={e => update('species', e.target.value)}><option>Dog</option><option>Cat</option><option>Other</option></select></label><label>Age<input value={pet.age} onChange={e => update('age', e.target.value)} /></label></div><label>Safety note<textarea value={pet.note} onChange={e => update('note', e.target.value)} placeholder="Anything a finder should know?" /></label><div className="visibility"><div><h3>Public profile</h3><p>These settings control what a finder can see.</p></div><label className="switch-row"><input type="checkbox" checked={pet.publicPhoto} onChange={e => update('publicPhoto', e.target.checked)} /><span>Pet photo</span></label><label className="switch-row"><input type="checkbox" checked={pet.publicNote} onChange={e => update('publicNote', e.target.checked)} /><span>Safety note</span></label><label className="switch-row"><input type="checkbox" checked={pet.missing} onChange={e => update('missing', e.target.checked)} /><span>Mark missing</span></label></div><div className="form-footer"><span className="private-handle">Owner handle: <strong>{ownerHandle}</strong> <small>public</small></span><button className="primary-btn" type="submit">{saved ? 'Saved ✓' : 'Save profile'}</button></div></form><div className="data-controls"><div><strong>Remove this profile</strong><p>This removes {pet.name}, their conversations, and uploaded photo from your Leo Reunite account.</p></div><button type="button" className="danger-btn" onClick={() => window.confirm(`Delete ${pet.name}'s profile and conversations? This cannot be undone.`) && deletePet()}>Delete profile</button></div></main></Shell>
}

function ScanPageRealtime({ pet, message, setMessage, sent, setSent, sendFinderMessage, reportPet }) {
  const [messages, setMessages] = useState([]); const [conversationId, setConversationId] = useState(null); const [requestStatus, setRequestStatus] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [coords, setCoords] = useState(null); const [reportOpen, setReportOpen] = useState(false); const [reportReason, setReportReason] = useState(''); const [reportStatus, setReportStatus] = useState('')
  const { token, sessionId } = getFinderRoute(); const deviceId = useMemo(() => getFinderDeviceId(token), [token])
  const sessionMismatch = Boolean(sessionId && sessionId !== deviceId)
  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    if (sessionMismatch) { setError('This finder session was opened on another device and has expired. Scan the pet QR again to start a new session.'); return undefined }
    const load = async () => { const { data, error: loadError } = await supabase.rpc('get_public_messages_v5', { p_token: token, p_device_id: deviceId, p_session_id: sessionId }); if (active && !loadError) { setMessages(data || []); const latest = (data || []).at(-1); if (latest?.conversation_id) { setConversationId(current => current || latest.conversation_id); setRequestStatus(latest.request_status); setSent(true) } if ((data || []).some(item => item.sender_role === 'owner')) supabase.rpc('mark_public_messages_seen', { p_token: token }) } }
    load()
    const channel = supabase.channel(`pet:${token}:${deviceId}`).on('broadcast', { event: 'message' }, ({ payload }) => { const incoming = payload?.record; if (!active || !incoming?.id) return; setMessages(current => current.some(item => item.id === incoming.id) ? current : [...current, incoming].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))); if (incoming.sender_role === 'owner') supabase.rpc('mark_public_messages_seen', { p_token: token }) }).subscribe()
    const timer = window.setInterval(load, 30000)
    return () => { active = false; window.clearInterval(timer); supabase.removeChannel(channel) }
  }, [token, deviceId, sessionId, sessionMismatch])
  useEffect(() => { if (sent && conversationId && !sessionId && !sessionMismatch) history.replaceState(null, '', `${location.pathname}#/pet/${token}/${deviceId}`) }, [sent, conversationId, sessionId, sessionMismatch, token, deviceId])
  const send = async e => { e.preventDefault(); if (!message.trim() || sessionMismatch) return; if (conversationId && requestStatus !== 'accepted') { setError(requestStatus === 'ignored' ? 'This message request was not accepted by the owner.' : 'Your first message is waiting for the owner to accept the chat.'); return } setBusy(true); setError(''); const result = await sendFinderMessage({ body: message.trim(), coords, conversationId, deviceId }); if (result.error) setError(result.error.message); else { setConversationId(current => current || result.data); setRequestStatus(current => current || 'pending'); setMessage(''); setSent(true) } setBusy(false) }
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
      if ((data || []).some(item => item.sender_role === 'owner')) supabase.rpc('mark_public_messages_seen_v2', { p_token: token, p_device_id: deviceId })
      }
    }
    loadReplies()
    const channel = supabase.channel(`pet:${token}`)
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const incoming = payload?.record
        if (!active || !incoming?.id) return
        setReplies(current => current.some(item => item.id === incoming.id) ? current : [...current, incoming].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)))
        if (incoming.sender_role === 'owner') supabase.rpc('mark_public_messages_seen_v2', { p_token: token, p_device_id: deviceId })
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

function InboxPageWithClear({ inbox, error, reload, go, supabase, feedback, dismissFeedback }) {
  const [selected, setSelected] = useState(inbox[0] || null); const [reply, setReply] = useState(''); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState('')
  useEffect(() => { if (selected && !inbox.some(item => item.id === selected.id)) setSelected(inbox[0] || null); else if (!selected && inbox[0]) setSelected(inbox[0]) }, [inbox, selected])
  const send = async e => { e.preventDefault(); if (!reply.trim() || !selected) return; setBusy(true); setActionError(''); const { error: sendError } = await supabase.from('messages').insert({ conversation_id: selected.id, sender_role: 'owner', body: reply.trim(), delivered_at: new Date().toISOString() }); if (sendError) setActionError(sendError.message); else { setReply(''); await reload() } setBusy(false) }
  const clearOne = async () => { if (!selected || !window.confirm('Clear this conversation? This cannot be undone.')) return; setBusy(true); setActionError(''); const { error: deleteError } = await supabase.from('conversations').delete().eq('id', selected.id); if (deleteError) setActionError(deleteError.message); else { setSelected(null); await reload() } setBusy(false) }
  const clearAll = async () => { if (!inbox.length || !window.confirm(`Clear all ${inbox.length} past conversations? This cannot be undone.`)) return; setBusy(true); setActionError(''); const { error: deleteError } = await supabase.from('conversations').delete().in('id', inbox.map(item => item.id)); if (deleteError) setActionError(deleteError.message); else { setSelected(null); await reload() } setBusy(false) }
  const blockOne = async () => { if (!selected || selected.blocked_at || !window.confirm('Block this finder? They will not be able to start another conversation from this device.')) return; setBusy(true); setActionError(''); const { error: blockError } = await supabase.from('conversations').update({ blocked_at: new Date().toISOString() }).eq('id', selected.id); if (blockError) setActionError(blockError.message); else { setSelected(current => ({ ...current, blocked_at: new Date().toISOString() })); await reload() } setBusy(false) }
  return <Shell go={go} feedback={feedback} dismissFeedback={dismissFeedback}><main className="page inbox-page"><div className="eyebrow">PRIVATE INBOX</div><div className="section-heading"><div><h3>Finder messages</h3><p className="lead">Reply without revealing your personal contact details.</p></div><div className="inbox-tools"><button className="outline-btn" onClick={reload}>Refresh</button><button className="clear-history-btn" onClick={clearAll} disabled={!inbox.length || busy}>Clear past conversations</button></div></div>{(error || actionError) && <div className="auth-error">{error || actionError}</div>}<div className="inbox-layout"><aside className="conversation-list">{inbox.length ? inbox.map(c => <button className={`conversation ${selected?.id === c.id ? 'active' : ''}`} onClick={() => setSelected(c)} key={c.id}><strong>{c.pets?.name || 'Your pet'}</strong><span>{new Date(c.created_at).toLocaleString()}</span><p>{c.messages?.[c.messages.length - 1]?.body || 'New message'}</p></button>) : <div className="empty-state">No finder messages yet.<br /><small>Messages sent from your pet’s QR page will appear here.</small></div>}</aside><section className="conversation-view">{selected ? <><div className="conversation-head"><div><div className="eyebrow">CONVERSATION</div><h3>{selected.pets?.name || 'Your pet'}</h3></div><button className="clear-history-btn" onClick={clearOne} disabled={busy}>Clear</button></div><div className="message-thread">{(selected.messages || []).sort((a,b) => new Date(a.created_at)-new Date(b.created_at)).map(m => <div className={`thread-message ${m.sender_role}`} key={m.id}><div className="message-meta"><span>{m.sender_role === 'finder' ? 'Finder' : 'You'}</span>{m.sender_role === 'owner' && <span className={`message-status ${m.seen_at ? 'seen' : ''}`}>{m.seen_at || m.delivered_at ? '✓✓' : '✓'}</span>}</div><p>{m.body}</p>{m.location_lat && m.location_lng && <a className="location-link" href={`https://www.google.com/maps?q=${m.location_lat},${m.location_lng}`} target="_blank" rel="noreferrer">View approximate finder location →</a>}<small>{new Date(m.created_at).toLocaleString()}</small></div>)}</div><form className="reply-box" onSubmit={send}><textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply…" maxLength="2000" /><button className="primary-btn" disabled={!reply.trim() || busy}>{busy ? 'Sending…' : 'Reply'}</button></form></> : <div className="empty-state">Select a conversation to read and reply.</div>}</section></div></main></Shell>
}

function InboxPageWithBlock({ inbox, error, reload, go, supabase, feedback, dismissFeedback }) {
  const [selected, setSelected] = useState(inbox[0] || null); const [reply, setReply] = useState(''); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState('')
  useEffect(() => { if (selected && !inbox.some(item => item.id === selected.id)) setSelected(inbox[0] || null); else if (!selected && inbox[0]) setSelected(inbox[0]) }, [inbox, selected])
  const send = async e => { e.preventDefault(); if (!reply.trim() || !selected || selected.blocked_at) return; setBusy(true); setActionError(''); const { error: sendError } = await supabase.from('messages').insert({ conversation_id: selected.id, sender_role: 'owner', body: reply.trim(), delivered_at: new Date().toISOString() }); if (sendError) setActionError(sendError.message); else { setReply(''); await reload() } setBusy(false) }
  const block = async () => { if (!selected || selected.blocked_at || !window.confirm('Block this finder? This device will not be able to start another conversation for this pet.')) return; setBusy(true); setActionError(''); const blockedAt = new Date().toISOString(); const { error: blockError } = await supabase.from('conversations').update({ blocked_at: blockedAt }).eq('id', selected.id); if (blockError) setActionError(blockError.message); else { setSelected(current => ({ ...current, blocked_at: blockedAt })); await reload() } setBusy(false) }
  const clearAll = async () => { if (!inbox.length || !window.confirm(`Clear all ${inbox.length} past conversations? This cannot be undone.`)) return; setBusy(true); const { error: deleteError } = await supabase.from('conversations').delete().in('id', inbox.map(item => item.id)); if (deleteError) setActionError(deleteError.message); else { setSelected(null); await reload() } setBusy(false) }
  return <Shell go={go} feedback={feedback} dismissFeedback={dismissFeedback}><main className="page inbox-page"><div className="eyebrow">PRIVATE INBOX</div><div className="section-heading"><div><h3>Finder messages</h3><p className="lead">Reply without revealing your personal contact details.</p></div><div className="inbox-tools"><button className="outline-btn" onClick={reload}>Refresh</button><button className="clear-history-btn" onClick={clearAll} disabled={!inbox.length || busy}>Clear past conversations</button></div></div>{(error || actionError) && <div className="auth-error">{error || actionError}</div>}<div className="inbox-layout"><aside className="conversation-list">{inbox.length ? inbox.map(c => <button className={`conversation ${selected?.id === c.id ? 'active' : ''}`} onClick={() => setSelected(c)} key={c.id}><strong>{c.pets?.name || 'Your pet'}</strong><span>{c.blocked_at ? 'Blocked' : new Date(c.created_at).toLocaleString()}</span><p>{c.messages?.[c.messages.length - 1]?.body || 'New message'}</p></button>) : <div className="empty-state">No finder messages yet.<br /><small>Messages sent from your pet’s QR page will appear here.</small></div>}</aside><section className="conversation-view">{selected ? <><div className="conversation-head"><div><div className="eyebrow">CONVERSATION</div><h3>{selected.pets?.name || 'Your pet'}</h3></div><button className="clear-history-btn" onClick={block} disabled={busy || Boolean(selected.blocked_at)}>{selected.blocked_at ? 'Finder blocked' : 'Block finder'}</button></div>{selected.blocked_at && <div className="blocked-banner">This finder is blocked. Their device cannot continue this conversation.</div>}<div className="message-thread">{(selected.messages || []).sort((a,b) => new Date(a.created_at)-new Date(b.created_at)).map(m => <div className={`thread-message ${m.sender_role}`} key={m.id}><div className="message-meta"><span>{m.sender_role === 'finder' ? 'Finder' : 'You'}</span>{m.sender_role === 'owner' && <span className={`message-status ${m.seen_at ? 'seen' : ''}`}>{m.seen_at || m.delivered_at ? '✓✓' : '✓'}</span>}</div><p>{m.body}</p><small>{new Date(m.created_at).toLocaleString()}</small></div>)}</div><form className="reply-box" onSubmit={send}><textarea value={reply} onChange={e => setReply(e.target.value)} placeholder={selected.blocked_at ? 'Finder blocked' : 'Write a reply…'} maxLength="2000" disabled={Boolean(selected.blocked_at)} /><button className="primary-btn" disabled={!reply.trim() || busy || Boolean(selected.blocked_at)}>{busy ? 'Sending…' : 'Reply'}</button></form></> : <div className="empty-state">Select a conversation to read and reply.</div>}</section></div></main></Shell>
}

function InboxPageWithRequests({ inbox, error, reload, go, supabase, feedback, dismissFeedback }) {
  const [selected, setSelected] = useState(inbox[0] || null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    const current = selected && inbox.find(item => item.id === selected.id)
    if (current) setSelected(current)
    else setSelected(inbox[0] || null)
  }, [inbox])
  const updateRequest = async status => {
    if (!selected) return
    setBusy(true); setActionError('')
    const { error: updateError } = await supabase.from('conversations').update({ request_status: status }).eq('id', selected.id)
    if (updateError) setActionError(updateError.message)
    else { await reload() }
    setBusy(false)
  }
  const block = async () => {
    if (!selected || selected.blocked_at || !window.confirm('Block this finder? This device will not be able to start another conversation for this pet.')) return
    setBusy(true); setActionError('')
    const blockedAt = new Date().toISOString()
    const { error: blockError } = await supabase.from('conversations').update({ blocked_at: blockedAt }).eq('id', selected.id)
    if (blockError) setActionError(blockError.message)
    else { await reload() }
    setBusy(false)
  }
  const send = async e => {
    e.preventDefault()
    if (!reply.trim() || !selected || selected.blocked_at || selected.request_status !== 'accepted') return
    setBusy(true); setActionError('')
    const { error: sendError } = await supabase.from('messages').insert({ conversation_id: selected.id, sender_role: 'owner', body: reply.trim(), delivered_at: new Date().toISOString() })
    if (sendError) setActionError(sendError.message)
    else { setReply(''); await reload() }
    setBusy(false)
  }
  const clearAll = async () => {
    if (!inbox.length || !window.confirm(`Clear all ${inbox.length} past conversations? This cannot be undone.`)) return
    setBusy(true); setActionError('')
    const { error: deleteError } = await supabase.from('conversations').delete().in('id', inbox.map(item => item.id))
    if (deleteError) setActionError(deleteError.message)
    else { setSelected(null); await reload() }
    setBusy(false)
  }
  const statusLabel = c => c.blocked_at ? 'Blocked' : c.request_status === 'accepted' ? 'Accepted' : c.request_status === 'ignored' ? 'Ignored' : 'Message request'
  const statusClass = c => c.blocked_at ? 'blocked' : c.request_status === 'accepted' ? 'accepted' : c.request_status === 'ignored' ? 'ignored' : 'pending'
  const locked = selected && (selected.blocked_at || selected.request_status !== 'accepted')
  return <Shell go={go} feedback={feedback} dismissFeedback={dismissFeedback}><main className="page inbox-page"><div className="eyebrow">PRIVATE INBOX</div><div className="section-heading"><div><h3>Finder messages</h3><p className="lead">Review a finder’s first message before opening a chat.</p></div><div className="inbox-tools"><button className="outline-btn" onClick={reload}>Refresh</button><button className="clear-history-btn" onClick={clearAll} disabled={!inbox.length || busy}>Clear past conversations</button></div></div>{(error || actionError) && <div className="auth-error">{error || actionError}</div>}<div className="inbox-layout"><aside className="conversation-list">{inbox.length ? inbox.map(c => <button className={`conversation ${selected?.id === c.id ? 'active' : ''}`} onClick={() => setSelected(c)} key={c.id}><strong>{c.pets?.name || 'Your pet'}</strong><span className={`request-status ${statusClass(c)}`}>{statusLabel(c)}</span><p>{c.messages?.[c.messages.length - 1]?.body || 'New message'}</p></button>) : <div className="empty-state">No finder messages yet.<br /><small>Messages sent from your pet’s QR page will appear here.</small></div>}</aside><section className="conversation-view">{selected ? <><div className="conversation-head"><div><div className="eyebrow">{selected.request_status === 'pending' ? 'MESSAGE REQUEST' : 'CONVERSATION'}</div><h3>{selected.pets?.name || 'Your pet'}</h3></div><div className="conversation-actions">{selected.request_status === 'pending' && !selected.blocked_at && <><button className="primary-btn" onClick={() => updateRequest('accepted')} disabled={busy}>Accept</button><button className="clear-history-btn" onClick={() => updateRequest('ignored')} disabled={busy}>Ignore</button></>}<button className="clear-history-btn" onClick={block} disabled={busy || Boolean(selected.blocked_at)}>{selected.blocked_at ? 'Finder blocked' : 'Block finder'}</button></div></div>{selected.request_status === 'pending' && !selected.blocked_at && <div className="request-banner"><strong>New message request</strong><p>Accept to open a private chat. Ignore if you do not want further messages from this finder.</p></div>}{selected.request_status === 'ignored' && !selected.blocked_at && <div className="blocked-banner">This request was ignored. The finder cannot continue this chat.</div>}{selected.blocked_at && <div className="blocked-banner">This finder is blocked. Their device cannot continue this conversation.</div>}<div className="message-thread">{(selected.messages || []).sort((a,b) => new Date(a.created_at)-new Date(b.created_at)).map(m => <div className={`thread-message ${m.sender_role}`} key={m.id}><div className="message-meta"><span>{m.sender_role === 'finder' ? 'Finder' : 'You'}</span>{m.sender_role === 'owner' && <span className={`message-status ${m.seen_at ? 'seen' : ''}`}>{m.seen_at || m.delivered_at ? '✓✓' : '✓'}</span>}</div><p>{m.body}</p>{m.location_lat && m.location_lng && <a className="location-link" href={`https://www.google.com/maps?q=${m.location_lat},${m.location_lng}`} target="_blank" rel="noreferrer">View approximate finder location →</a>}<small>{new Date(m.created_at).toLocaleString()}</small></div>)}</div><form className="reply-box" onSubmit={send}><textarea value={reply} onChange={e => setReply(e.target.value)} placeholder={locked ? 'Accept this request to reply…' : 'Write a reply…'} maxLength="2000" disabled={Boolean(locked)} /><button className="primary-btn" disabled={!reply.trim() || busy || Boolean(locked)}>{busy ? 'Sending…' : 'Reply'}</button></form></> : <div className="empty-state">Select a conversation to read and reply.</div>}</section></div></main></Shell>
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

class AppErrorBoundary extends React.Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error) { console.error('Leo Reunite crashed:', error) }
  render() {
    if (!this.state.hasError) return this.props.children
    return <div className="auth-page"><div className="scan-brand"><span className="brand-mark">L</span> Leo Reunite</div><main className="auth-card"><div className="eyebrow">SORRY, SOMETHING WENT WRONG</div><h1>Let’s get you back safely.</h1><p>This page hit an unexpected error. Your saved account data is unchanged.</p><button className="primary-btn" onClick={() => window.location.reload()}>Reload Leo Reunite</button></main></div>
  }
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>)
