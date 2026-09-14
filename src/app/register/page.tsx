import { signUpAction } from '@/app/actions/auth';
import { AuthForm, AuthShell } from '@/components/auth-form';

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Take charge of a club and manage it from your phone."
      alternate={{ href: '/login', label: 'Already have an account? Sign in' }}
    >
      <AuthForm
        action={signUpAction}
        submitLabel="Create account"
        fields={[
          { name: 'displayName', label: 'Your name', autoComplete: 'name' },
          { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
          { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password', hint: 'At least 10 characters.' },
          { name: 'inviteCode', label: 'League invite code', required: false, hint: 'Optional. You can join a league later.' },
        ]}
      />
    </AuthShell>
  );
}
