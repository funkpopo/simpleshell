import React from "react";
import {
  TextField,
  Button,
  Box,
  Typography,
  IconButton,
  Chip,
  Tooltip,
  Card,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import LockIcon from "@mui/icons-material/Lock";
import { useTranslation } from "react-i18next";
import { RISK_LEVELS, getBuiltinRiskPatterns } from "../lib/aiSystemPrompt";
import {
  RISK_RULE_LEVELS,
  getRiskLevelColor,
  getRiskLevelLabel,
} from "../lib/aiSettingsModel.js";
import { Z_INDEX } from "../../../shared/constants/zIndex.js";

// 风险等级分组标题：等级 Chip + 规则数量
function RiskLevelHeader({ level, count }) {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        mb: 0.5,
      }}
    >
      <Chip
        label={getRiskLevelLabel(t, level)}
        size="small"
        sx={{
          bgcolor: getRiskLevelColor(level),
          color: "white",
        }}
      />
      <Typography variant="body2" color="text.secondary">
        ({count})
      </Typography>
    </Box>
  );
}

// 内置规则（只读）
function BuiltinRiskRules() {
  const { t } = useTranslation();
  return (
    <Box sx={{ mt: 4 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 1.5,
        }}
      >
        <LockIcon fontSize="small" color="action" />
        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
          {t("aiSettings.builtinRules")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          ({t("aiSettings.readOnly")})
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("aiSettings.builtinRulesDescription")}
      </Typography>
      {RISK_RULE_LEVELS.map((level) => {
        const builtinPatterns = getBuiltinRiskPatterns()[level] || [];
        return (
          builtinPatterns.length > 0 && (
            <Box key={`builtin-${level}`} sx={{ mb: 2 }}>
              <RiskLevelHeader level={level} count={builtinPatterns.length} />
              <List
                dense
                sx={{
                  bgcolor: "action.hover",
                  borderRadius: 1,
                  maxHeight: 200,
                  overflow: "auto",
                  opacity: 0.8,
                }}
              >
                {builtinPatterns.map((pattern, index) => (
                  <ListItem key={index} sx={{ py: 0.25 }}>
                    <ListItemText
                      slotProps={{
                        primary: {
                          fontFamily: "monospace",
                          fontSize: "0.8rem",
                          color: "text.secondary",
                        },
                      }}
                      primary={pattern}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )
        );
      })}
    </Box>
  );
}

// 自定义风险规则标签页：新增规则、按等级分组的规则列表、保存、内置规则只读展示。
export default function CustomRiskRulesTab({
  customRules,
  newRulePattern,
  setNewRulePattern,
  newRuleLevel,
  setNewRuleLevel,
  ruleError,
  saving,
  dirty,
  onAddRule,
  onDeleteRule,
  onSaveRules,
}) {
  const { t } = useTranslation();

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t("aiSettings.customRulesDescription")}
      </Typography>

      {/* 添加新规则 */}
      <Card variant="outlined" sx={{ mb: 3, p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 2 }}>
          {t("aiSettings.addNewRule")}
        </Typography>
        <Box
          sx={{
            display: "flex",
            gap: 1.5,
            alignItems: "flex-start",
          }}
        >
          <TextField
            value={newRulePattern}
            onChange={(e) => setNewRulePattern(e.target.value)}
            placeholder={t("aiSettings.rulePatternPlaceholder")}
            size="small"
            sx={{ flex: 1 }}
            error={!!ruleError}
            helperText={ruleError || " "}
          />
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>{t("aiSettings.riskLevel")}</InputLabel>
            <Select
              value={newRuleLevel}
              onChange={(e) => setNewRuleLevel(e.target.value)}
              label={t("aiSettings.riskLevel")}
              MenuProps={{
                sx: {
                  zIndex: Z_INDEX.modalPopup,
                },
              }}
            >
              <MenuItem value="critical">
                <Chip
                  label={t("ai.riskLevels.critical")}
                  size="small"
                  sx={{
                    bgcolor: RISK_LEVELS.CRITICAL.color,
                    color: "white",
                  }}
                />
              </MenuItem>
              <MenuItem value="high">
                <Chip
                  label={t("ai.riskLevels.high")}
                  size="small"
                  sx={{
                    bgcolor: RISK_LEVELS.HIGH.color,
                    color: "white",
                  }}
                />
              </MenuItem>
              <MenuItem value="medium">
                <Chip
                  label={t("ai.riskLevels.medium")}
                  size="small"
                  sx={{
                    bgcolor: RISK_LEVELS.MEDIUM.color,
                    color: "white",
                  }}
                />
              </MenuItem>
              <MenuItem value="low">
                <Chip
                  label={t("ai.riskLevels.low")}
                  size="small"
                  sx={{
                    bgcolor: RISK_LEVELS.LOW.color,
                    color: "white",
                  }}
                />
              </MenuItem>
            </Select>
          </FormControl>
          <Tooltip title={t("aiSettings.addNewRule")}>
            <IconButton
              onClick={onAddRule}
              color="primary"
              sx={{ mt: 0.5 }}
              aria-label={t("aiSettings.addNewRule")}
            >
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Card>

      {/* 自定义规则列表 */}
      <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 500 }}>
        {t("aiSettings.customRulesList")}
      </Typography>
      {Object.values(customRules).every((arr) => arr.length === 0) ? (
        <Box
          sx={{
            textAlign: "center",
            py: 3,
            bgcolor: "action.hover",
            borderRadius: 1,
          }}
        >
          <Typography color="text.secondary">
            {t("aiSettings.noCustomRules")}
          </Typography>
        </Box>
      ) : (
        RISK_RULE_LEVELS.map(
          (level) =>
            customRules[level]?.length > 0 && (
              <Box key={level} sx={{ mb: 2 }}>
                <RiskLevelHeader
                  level={level}
                  count={customRules[level].length}
                />
                <List dense sx={{ bgcolor: "action.hover", borderRadius: 1 }}>
                  {customRules[level].map((pattern, index) => (
                    <ListItem key={index} sx={{ py: 0.5 }}>
                      <ListItemText
                        slotProps={{
                          primary: {
                            fontFamily: "monospace",
                            fontSize: "0.85rem",
                          },
                        }}
                        primary={pattern}
                      />
                      <ListItemSecondaryAction>
                        <Tooltip title={t("aiSettings.deleteRule")}>
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => onDeleteRule(level, index)}
                            aria-label={t("aiSettings.deleteRule")}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              </Box>
            ),
        )
      )}

      {/* 保存按钮 */}
      <Box
        sx={{
          mt: 2,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 2,
        }}
      >
        {dirty && (
          <Typography variant="caption" color="warning.main">
            {t("aiSettings.rulesUnsaved")}
          </Typography>
        )}
        <Button variant="contained" onClick={onSaveRules} disabled={saving}>
          {t("aiSettings.saveRules")}
        </Button>
      </Box>

      <BuiltinRiskRules />
    </Box>
  );
}
