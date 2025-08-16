import React, { memo, useCallback, useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import CircularProgress from '@mui/material/CircularProgress';
import { styled } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

// Glass effect dialog component
const GlassDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(40, 44, 52, 0.75)'
        : 'rgba(255, 255, 255, 0.75)',
    backdropFilter: 'blur(10px)',
    boxShadow:
      theme.palette.mode === 'dark'
        ? '0 8px 32px 0 rgba(0, 0, 0, 0.37)'
        : '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
    border: '1px solid rgba(255, 255, 255, 0.18)',
  },
}));

const AboutDialog = memo(function AboutDialog({ open, onClose }) {
  const { t } = useTranslation();
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [latestRelease, setLatestRelease] = useState(null);

  // Get app version
  useEffect(() => {
    if (window.terminalAPI?.getAppVersion) {
      const versionPromise = window.terminalAPI.getAppVersion();
      if (versionPromise instanceof Promise) {
        versionPromise.then((version) => setAppVersion(version));
      } else {
        setAppVersion(versionPromise || '1.0.0');
      }
    }
  }, []);

  // Open external link
  const handleOpenExternalLink = useCallback(
    (url) => {
      if (window.terminalAPI?.openExternal) {
        window.terminalAPI.openExternal(url).catch((error) => {
          alert(t('app.cannotOpenLinkAlert', { url }));
        });
      } else {
        window.open(url, '_blank');
      }
    },
    [t]
  );

  // Check for updates
  const handleCheckForUpdate = useCallback(() => {
    setCheckingForUpdate(true);
    setUpdateStatus(t('about.checkingUpdate'));

    if (!window.terminalAPI?.checkForUpdate) {
      setUpdateStatus(t('about.updateNotAvailable'));
      setCheckingForUpdate(false);
      return;
    }

    window.terminalAPI
      .checkForUpdate()
      .then((result) => {
        if (!result.success) {
          throw new Error(result.error || t('app.unknownUpdateError'));
        }

        const releaseData = result.data;
        setLatestRelease(releaseData);

        const latestVersion = releaseData.tag_name;
        const currentVersion = appVersion;

        const latestVersionNumber = latestVersion.replace(/^v/, '');
        const currentVersionNumber = currentVersion.replace(/^v/, '');

        if (latestVersionNumber > currentVersionNumber) {
          setUpdateStatus(t('about.newVersion', { version: latestVersion }));
        } else {
          setUpdateStatus(t('about.latestVersion'));
        }
      })
      .catch((error) => {
        setUpdateStatus(t('about.updateError', { error: error.message }));
      })
      .finally(() => {
        setCheckingForUpdate(false);
      });
  }, [t, appVersion]);

  return (
    <GlassDialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('about.title')}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            SimpleShell
          </Typography>
          <Typography variant="body1" gutterBottom>
            {t('about.version')}: {appVersion}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('about.description')}
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
            {t('about.author')}
          </Typography>
          <Typography variant="body2">{t('about.author')}: funkpopo</Typography>
          <Typography variant="body2">
            {t('about.email')}:{' '}
            <Link
              href="#"
              onClick={(e) => {
                e.preventDefault();
                handleOpenExternalLink('mailto:s767609509@gmail.com');
              }}
            >
              s767609509@gmail.com
            </Link>
          </Typography>

          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle1" gutterBottom>
              {t('about.updateCheck')}
            </Typography>
            {updateStatus && (
              <Typography
                variant="body2"
                color={
                  updateStatus === t('about.latestVersion')
                    ? 'success.main'
                    : 'text.secondary'
                }
              >
                {updateStatus}
              </Typography>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Button
                variant="outlined"
                onClick={handleCheckForUpdate}
                disabled={checkingForUpdate}
                startIcon={
                  checkingForUpdate ? <CircularProgress size={16} /> : null
                }
              >
                {t('about.checkUpdateButton')}
              </Button>

              {latestRelease && latestRelease.html_url && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => handleOpenExternalLink(latestRelease.html_url)}
                >
                  {t('about.viewLatestButton')}
                </Button>
              )}
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('about.close')}</Button>
        <Button
          onClick={() =>
            handleOpenExternalLink(
              'https://github.com/funkpopo/simpleshell/releases'
            )
          }
        >
          {t('about.visitGithub')}
        </Button>
      </DialogActions>
    </GlassDialog>
  );
});

AboutDialog.displayName = 'AboutDialog';

export default AboutDialog;