import React, { useState, useCallback, memo } from "react";
import {
  Box,
  Paper,
  Typography,
  Slider,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Button,
  TextField,
  IconButton,
  Tooltip,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckIcon from "@mui/icons-material/Check";

const RandomPasswordGenerator = ({ open, onClose }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [length, setLength] = useState(8);
  const [options, setOptions] = useState({
    uppercase: true,
    lowercase: true,
    numbers: false,
    symbols: false,
  });
  const [password, setPassword] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  const handleOptionChange = (event) => {
    setOptions({ ...options, [event.target.name]: event.target.checked });
  };

  const generatePassword = useCallback(() => {
    const charSets = {
      uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      lowercase: "abcdefghijklmnopqrstuvwxyz",
      numbers: "0123456789",
      symbols: "!@#$%^&*()_+~`|}{[]:;?><,./-=",
    };

    let availableChars = "";
    if (options.uppercase) availableChars += charSets.uppercase;
    if (options.lowercase) availableChars += charSets.lowercase;
    if (options.numbers) availableChars += charSets.numbers;
    if (options.symbols) availableChars += charSets.symbols;

    if (!availableChars) {
      setPassword("");
      return;
    }

    let generatedPassword = "";
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * availableChars.length);
      generatedPassword += availableChars[randomIndex];
    }
    setPassword(generatedPassword);
  }, [length, options]);

  const copyToClipboard = () => {
    if (password) {
      navigator.clipboard.writeText(password).then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      });
    }
  };

  React.useEffect(() => {
    if (open) {
      generatePassword();
    }
  }, [open, generatePassword]);

  return (
    <Paper
      elevation={4}
      sx={{
        width: open ? 300 : 0,
        height: "100%",
        overflow: "hidden",
        transition: theme.transitions.create("width", {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        borderLeft: `1px solid ${theme.palette.divider}`,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
      }}
    >
      {open && (
        <>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              p: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Typography variant="subtitle1" fontWeight="medium">
              {t("randomPassword.title")}
            </Typography>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box
            sx={{
              flexGrow: 1,
              overflow: "hidden",
              overflowY: "auto",
              p: 1.5,
            }}
          >
            <Box sx={{ mb: 1.5, px: 1 }}>
              <Typography gutterBottom sx={{ fontSize: "0.9rem" }}>
                {t("randomPassword.length")}: {length}
              </Typography>
              <Slider
                value={length}
                onChange={(e, newValue) => setLength(newValue)}
                aria-labelledby="password-length-slider"
                valueLabelDisplay="auto"
                step={1}
                min={4}
                max={32}
                sx={{
                  width: "100%",
                  "& .MuiSlider-valueLabel": {
                    fontSize: "0.75rem",
                  },
                  "& .MuiSlider-thumb": {
                    "&:hover, &.Mui-focusVisible": {
                      boxShadow: "none",
                    },
                  },
                  "& .MuiSlider-track": {
                    border: "none",
                  },
                }}
              />
            </Box>

            <FormGroup sx={{ mb: 1.5 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={options.uppercase}
                    onChange={handleOptionChange}
                    name="uppercase"
                    size="small"
                  />
                }
                label={
                  <Typography sx={{ fontSize: "0.85rem" }}>
                    {t("randomPassword.uppercase")}
                  </Typography>
                }
                sx={{ ml: 0 }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={options.lowercase}
                    onChange={handleOptionChange}
                    name="lowercase"
                    size="small"
                  />
                }
                label={
                  <Typography sx={{ fontSize: "0.85rem" }}>
                    {t("randomPassword.lowercase")}
                  </Typography>
                }
                sx={{ ml: 0 }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={options.numbers}
                    onChange={handleOptionChange}
                    name="numbers"
                    size="small"
                  />
                }
                label={
                  <Typography sx={{ fontSize: "0.85rem" }}>
                    {t("randomPassword.numbers")}
                  </Typography>
                }
                sx={{ ml: 0 }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={options.symbols}
                    onChange={handleOptionChange}
                    name="symbols"
                    size="small"
                  />
                }
                label={
                  <Typography sx={{ fontSize: "0.85rem" }}>
                    {t("randomPassword.symbols")}
                  </Typography>
                }
                sx={{ ml: 0 }}
              />
            </FormGroup>

            <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
              <TextField
                value={password}
                label={t("randomPassword.generatedPassword")}
                variant="outlined"
                fullWidth
                size="small"
                InputProps={{
                  readOnly: true,
                }}
              />
              <Tooltip
                title={
                  copySuccess
                    ? t("randomPassword.copied")
                    : t("randomPassword.copy")
                }
                onClose={() => setCopySuccess(false)}
              >
                <IconButton
                  onClick={copyToClipboard}
                  sx={{ ml: 1 }}
                  size="small"
                >
                  {copySuccess ? (
                    <CheckIcon color="success" />
                  ) : (
                    <ContentCopyIcon />
                  )}
                </IconButton>
              </Tooltip>
            </Box>

            <Button
              variant="contained"
              onClick={generatePassword}
              startIcon={<RefreshIcon />}
              size="small"
              fullWidth
            >
              {t("randomPassword.regenerate")}
            </Button>
          </Box>
        </>
      )}
    </Paper>
  );
};

export default memo(RandomPasswordGenerator);
