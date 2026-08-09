import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import * as yup from 'yup';
import PasswordTextField from 'components/common/PasswordTextField';
import DefaultCredentialAlert from '../common/DefaultCredentialAlert';
import ViewOnlyAlert from '../common/ViewOnlyAlert';

const schema = yup
  .object({
    email: yup
      .string()
      .email('Please provide a valid email address.')
      .required('This field is required'),
    password: yup.string().required('This field is required'),
  })
  .required();

const LoginForm = ({
  provider = 'jwt',
  handleLogin,
  signUpLink,
  forgotPasswordLink,
  socialAuth = true,
  rememberDevice = true,
  defaultCredential,
}) => {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data) => {
    await handleLogin(data).catch((error) => {
      if (error) {
        setError('root.credential', { type: 'manual', message: error.message });
      }
    });
  };

  return (
    <Stack
      direction="column"
      sx={{
        height: 1,
        alignItems: 'center',
        justifyContent: 'space-between',
        pt: { md: 10 },
        pb: 10,
      }}
    >
      <div />

      <Grid
        container
        sx={{
          maxWidth: '35rem',
          rowGap: 4,
          p: { xs: 3, sm: 5 },
          mb: 5,
        }}
      >
        {provider === 'firebase' && import.meta.env.VITE_BUILD_MODE === 'production' && (
          <Grid size={12} sx={{ mb: 1 }}>
            <ViewOnlyAlert />
          </Grid>
        )}
        <Grid size={12}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'flex-end' },
            }}
          >
            <Typography variant="h4">Log in</Typography>
            <Typography
              variant="subtitle2"
              sx={{
                color: 'text.secondary',
              }}
            >
              Don&apos;t have an account?
              <Link href={signUpLink} sx={{ ml: 1 }}>
                Sign up
              </Link>
            </Typography>
          </Stack>
        </Grid>
        {socialAuth && (
          <>
            <Grid size={12}></Grid>
            <Grid size={12}>
              <Divider sx={{ color: 'text.secondary' }}>or use email</Divider>
            </Grid>
          </>
        )}

        <Grid size={12}>
          <Box component="form" noValidate onSubmit={handleSubmit(onSubmit)}>
            {errors.root?.credential?.message && (
              <Alert severity="error" sx={{ mb: 3 }}>
                {errors.root?.credential?.message}
              </Alert>
            )}
            {defaultCredential && <DefaultCredentialAlert />}
            <Grid container>
              <Grid
                sx={{
                  mb: 3,
                }}
                size={12}
              >
                <TextField
                  fullWidth
                  size="large"
                  id="email"
                  type="email"
                  label="Email"
                  defaultValue={defaultCredential?.email}
                  error={!!errors.email}
                  helperText={<>{errors.email?.message}</>}
                  {...register('email')}
                />
              </Grid>
              <Grid
                sx={{
                  mb: 2.5,
                }}
                size={12}
              >
                <PasswordTextField
                  fullWidth
                  size="large"
                  id="password"
                  label="Password"
                  defaultValue={defaultCredential?.password}
                  error={!!errors.password}
                  helperText={<>{errors.password?.message}</>}
                  {...register('password')}
                />
              </Grid>
              <Grid
                sx={{
                  mb: 6,
                }}
                size={12}
              >
                <Stack
                  spacing={1}
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  {rememberDevice && (
                    <FormControlLabel
                      control={<Checkbox name="checked" color="primary" size="small" />}
                      label={
                        <Typography
                          variant="subtitle2"
                          sx={{
                            color: 'text.secondary',
                          }}
                        >
                          Remember this device
                        </Typography>
                      }
                    />
                  )}

                  {forgotPasswordLink && (
                    <Link href={forgotPasswordLink} variant="subtitle2">
                      Forgot Password?
                    </Link>
                  )}
                </Stack>
              </Grid>
              <Grid size={12}>
                <Button
                  fullWidth
                  type="submit"
                  size="large"
                  variant="contained"
                  loading={isSubmitting}
                >
                  Log in
                </Button>
              </Grid>
            </Grid>
          </Box>
        </Grid>
      </Grid>
      <Link href="#!" variant="subtitle2">
        Trouble signing in?
      </Link>
    </Stack>
  );
};

export default LoginForm;
