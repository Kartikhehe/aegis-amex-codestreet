import { useNavigate } from 'react-router';
import { defaultJwtAuthCredentials } from 'config';
import { useAuth } from 'providers/AuthProvider';
import paths, { rootPaths } from 'routes/paths';
import { useLoginUser } from 'services/swr/api-hooks/useAuthApi';
import LoginForm from 'components/sections/authentications/default/LoginForm';

const Login = () => {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const { trigger: login } = useLoginUser();
  const handleLogin = async (data) => {
    const res = await login(data).catch((error) => {
      throw new Error(error.data.message);
    });
    if (res) {
      // The API returns `token` (and `firebase_token` when Firestore is
      // configured); `authToken` was Aurora's demo field name.
      setSession(res.user, res.token ?? res.authToken, res.firebase_token);
      navigate(rootPaths.root);
    }
  };

  return (
    <LoginForm
      handleLogin={handleLogin}
      signUpLink={paths.defaultJwtSignup}
      forgotPasswordLink={paths.defaultJwtForgotPassword}
      defaultCredential={defaultJwtAuthCredentials}
    />
  );
};

export default Login;
