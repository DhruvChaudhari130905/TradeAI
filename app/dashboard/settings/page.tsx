'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { User, Lock, Trash2, Upload, Check, Loader2 } from 'lucide-react'

export default function SettingsPage() {
  const supabase = createClient()

  // Profile state
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Password state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Delete state
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .single()

      if (profile) {
        setUsername(profile.username ?? '')
        setAvatarUrl(profile.avatar_url ?? null)
      }
      setProfileLoading(false)
    }
    loadProfile()
  }, [supabase])

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setProfileMessage({ type: 'error', text: 'Only image files are allowed' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileMessage({ type: 'error', text: 'Avatar must be under 2MB' })
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const ext = file.name.split('.').pop() || 'png'
    const path = `${user.id}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { cacheControl: '3600', upsert: true })

    if (uploadError) {
      setProfileMessage({ type: 'error', text: 'Failed to upload avatar' })
      return
    }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const newUrl = `${urlData.publicUrl}?t=${Date.now()}`
    setAvatarUrl(newUrl)

    await supabase
      .from('profiles')
      .update({ avatar_url: newUrl })
      .eq('id', user.id)

    setProfileMessage({ type: 'success', text: 'Avatar updated!' })
    setTimeout(() => setProfileMessage(null), 3000)
  }

  const handleProfileSave = async () => {
    setProfileSaving(true)
    setProfileMessage(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setProfileMessage({ type: 'error', text: 'Not authenticated' })
      setProfileSaving(false)
      return
    }

    // upsert (not update) so a row is created if signup/OAuth didn't make one.
    // An update-only would match zero rows and silently report fake success.
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, username })

    if (error) {
      console.error('[handleProfileSave]', error)
      setProfileMessage({ type: 'error', text: 'Failed to update profile' })
    } else {
      setProfileMessage({ type: 'success', text: 'Profile saved!' })
      setTimeout(() => setProfileMessage(null), 3000)
    }
    setProfileSaving(false)
  }

  const handlePasswordChange = async () => {
    setPasswordSaving(true)
    setPasswordMessage(null)

    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'Password must be at least 6 characters' })
      setPasswordSaving(false)
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Passwords do not match' })
      setPasswordSaving(false)
      return
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) {
      setPasswordMessage({ type: 'error', text: error.message })
    } else {
      setPasswordMessage({ type: 'success', text: 'Password updated!' })
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordMessage(null), 3000)
    }
    setPasswordSaving(false)
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') return
    setDeleting(true)

    // Note: Full account deletion requires a server-side function with service role
    // For now, we delete user data and sign out
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Delete user data in order
    await supabase.from('trade_reviews').delete().eq('user_id', user.id)
    await supabase.from('dashboard_insights').delete().eq('user_id', user.id)
    await supabase.from('backtest_runs').delete().eq('user_id', user.id)
    await supabase.from('trades').delete().eq('user_id', user.id)
    await supabase.from('profiles').delete().eq('id', user.id)

    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  if (profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading settings…</span>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile, security, and account.
        </p>
      </div>

      {/* ── Profile Section ── */}
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-6">
            <User className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">Profile</h2>
          </div>

          {/* Avatar */}
          <div className="flex items-center gap-4 mb-6">
            <button
              type="button"
              aria-label={avatarUrl ? 'Change avatar' : 'Upload avatar'}
              onClick={() => fileInputRef.current?.click()}
              className="relative group flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-line-strong bg-background overflow-hidden transition-colors hover:border-primary/50"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <User className="h-6 w-6 text-muted-foreground" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                <Upload className="h-4 w-4 text-foreground" />
              </div>
            </button>
            <div>
              <p className="text-sm text-foreground">Avatar</p>
              <p className="text-xs text-muted-foreground">PNG or JPG, up to 2 MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </div>

          {/* Username */}
          <div className="space-y-2 mb-4">
            <Label htmlFor="username" className="text-xs text-muted-foreground">Username</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground"
              placeholder="Your username"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save profile
            </Button>
            {profileMessage && (
              <span role="status" className={`text-xs ${profileMessage.type === 'success' ? 'text-primary' : 'text-loss'}`}>
                {profileMessage.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Security Section ── */}
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-6">
            <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">Security</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-xs text-muted-foreground">New password</Label>
              <Input
                id="new-password"
                autoComplete="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="border-border bg-background text-foreground placeholder:text-muted-foreground"
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-xs text-muted-foreground">Confirm password</Label>
              <Input
                id="confirm-password"
                autoComplete="new-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="border-border bg-background text-foreground placeholder:text-muted-foreground"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handlePasswordChange}
              disabled={passwordSaving || !newPassword}
              variant="outline"
              className="gap-2 border-line-strong text-foreground hover:bg-background"
            >
              {passwordSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Update password
            </Button>
            {passwordMessage && (
              <span role="status" className={`text-xs ${passwordMessage.type === 'success' ? 'text-primary' : 'text-loss'}`}>
                {passwordMessage.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Danger Zone ── */}
      <Card className="border-loss/20 bg-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trash2 className="h-4 w-4 text-loss" />
            <h2 className="text-sm font-semibold text-loss">Delete account</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>

          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger
              render={
                <Button
                  variant="outline"
                  className="gap-2 border-loss/30 text-loss hover:bg-loss/10"
                />
              }
            >
              <Trash2 className="h-4 w-4" />
              Delete account
            </DialogTrigger>
            <DialogContent className="border-border bg-card">
              <DialogHeader>
                <DialogTitle className="text-foreground">Delete your account?</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  This will permanently delete all your trades, backtests, reviews, and profile data.
                  Type <span className="font-mono text-loss">DELETE</span> to confirm.
                </DialogDescription>
              </DialogHeader>
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                aria-label="Type DELETE to confirm"
                placeholder="DELETE"
                className="border-border bg-background text-foreground font-mono"
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteOpen(false)}
                  className="border-line-strong text-muted-foreground"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirm !== 'DELETE' || deleting}
                  className="bg-loss text-white hover:bg-loss/90"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete account'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  )
}
