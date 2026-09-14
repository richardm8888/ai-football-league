import { signInAction } from '@/app/actions/auth';
import { AuthForm, AuthShell } from '@/components/auth-form';

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Fantasy Football and Football Manager combined for the modern world."
      alternate={{ href: '/register', label: 'No account yet? Create one' }}
    >
      <AuthForm
        action={signInAction}
        submitLabel="Sign in"
        fields={[
          { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
          { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
        ]}
      />
    </AuthShell>
  );
}
