import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box,
  Typography,
  FormControlLabel,
  Checkbox,
  TextField,
  Grid,
  Divider,
  FormGroup,
  Alert,
} from "@mui/material";

const FilePermissionEditor = ({ permissions = "644", onChange }) => {
  const [octalValue, setOctalValue] = useState(permissions);
  const [permissionBits, setPermissionBits] = useState({
    ownerRead: false,
    ownerWrite: false,
    ownerExecute: false,
    groupRead: false,
    groupWrite: false,
    groupExecute: false,
    otherRead: false,
    otherWrite: false,
    otherExecute: false,
  });

  // 将八进制权限转换为权限位
  const octalToPermissionBits = useCallback((octal) => {
    const octalStr = String(octal).padStart(3, "0");
    const owner = parseInt(octalStr[0] || "0", 10);
    const group = parseInt(octalStr[1] || "0", 10);
    const other = parseInt(octalStr[2] || "0", 10);

    return {
      ownerRead: (owner & 4) !== 0,
      ownerWrite: (owner & 2) !== 0,
      ownerExecute: (owner & 1) !== 0,
      groupRead: (group & 4) !== 0,
      groupWrite: (group & 2) !== 0,
      groupExecute: (group & 1) !== 0,
      otherRead: (other & 4) !== 0,
      otherWrite: (other & 2) !== 0,
      otherExecute: (other & 1) !== 0,
    };
  }, []);

  // 将权限位转换为八进制权限
  const permissionBitsToOctal = useCallback((bits) => {
    const owner =
      (bits.ownerRead ? 4 : 0) +
      (bits.ownerWrite ? 2 : 0) +
      (bits.ownerExecute ? 1 : 0);
    const group =
      (bits.groupRead ? 4 : 0) +
      (bits.groupWrite ? 2 : 0) +
      (bits.groupExecute ? 1 : 0);
    const other =
      (bits.otherRead ? 4 : 0) +
      (bits.otherWrite ? 2 : 0) +
      (bits.otherExecute ? 1 : 0);

    return `${owner}${group}${other}`;
  }, []);

  // 当外部权限值改变时更新内部状态
  useEffect(() => {
    const newOctalValue = permissions || "644";
    // 只有当权限值真的改变时才更新
    if (newOctalValue !== octalValue) {
      setOctalValue(newOctalValue);
      setPermissionBits(octalToPermissionBits(newOctalValue));
    }
  }, [permissions]); // 移除octalToPermissionBits和octalValue依赖，避免循环

  // 组件初始化时设置权限位
  useEffect(() => {
    const initialValue = permissions || "644";
    setOctalValue(initialValue);
    setPermissionBits(octalToPermissionBits(initialValue));
  }, []); // 空依赖数组，只在组件挂载时执行一次

  // 处理八进制输入变化
  const handleOctalChange = (event) => {
    const value = event.target.value;
    // 验证输入是否为有效的八进制权限（000-777）
    if (/^[0-7]{0,3}$/.test(value)) {
      setOctalValue(value);
      if (value.length === 3) {
        const newBits = octalToPermissionBits(value);
        setPermissionBits(newBits);
        onChange && onChange(value);
      }
    }
  };

  // 处理权限位变化
  const handlePermissionChange = (permission) => (event) => {
    const newBits = {
      ...permissionBits,
      [permission]: event.target.checked,
    };
    setPermissionBits(newBits);

    const newOctal = permissionBitsToOctal(newBits);
    setOctalValue(newOctal);
    onChange && onChange(newOctal);
  };

  // 获取权限说明 - 使用useMemo优化性能
  const description = useMemo(() => {
    const descriptions = {
      0: "无权限",
      1: "执行",
      2: "写入",
      3: "写入+执行",
      4: "读取",
      5: "读取+执行",
      6: "读取+写入",
      7: "读取+写入+执行",
    };

    const octalStr = String(octalValue).padStart(3, "0");
    return {
      owner: descriptions[octalStr[0]] || "无效",
      group: descriptions[octalStr[1]] || "无效",
      other: descriptions[octalStr[2]] || "无效",
    };
  }, [octalValue]);

  return (
    <Box sx={{ width: "100%" }}>
      <Typography variant="subtitle2" sx={{ mb: 2 }}>
        文件权限设置
      </Typography>

      {/* 八进制输入框 */}
      <Box sx={{ mb: 3 }}>
        <TextField
          label="八进制权限值"
          value={octalValue}
          onChange={handleOctalChange}
          size="small"
          inputProps={{
            pattern: "[0-7]{3}",
            maxLength: 3,
          }}
          helperText="输入三位八进制数字 (000-777)"
          error={
            octalValue.length > 0 &&
            (octalValue.length !== 3 || !/^[0-7]{3}$/.test(octalValue))
          }
        />
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* 权限位勾选框 */}
      <Grid container spacing={2}>
        <Grid item xs={4}>
          <Typography variant="subtitle2" align="center" sx={{ mb: 1 }}>
            所有者 (Owner)
          </Typography>
          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionBits.ownerRead}
                  onChange={handlePermissionChange("ownerRead")}
                  size="small"
                />
              }
              label="读取 (r)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionBits.ownerWrite}
                  onChange={handlePermissionChange("ownerWrite")}
                  size="small"
                />
              }
              label="写入 (w)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionBits.ownerExecute}
                  onChange={handlePermissionChange("ownerExecute")}
                  size="small"
                />
              }
              label="执行 (x)"
            />
          </FormGroup>
        </Grid>

        <Grid item xs={4}>
          <Typography variant="subtitle2" align="center" sx={{ mb: 1 }}>
            组 (Group)
          </Typography>
          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionBits.groupRead}
                  onChange={handlePermissionChange("groupRead")}
                  size="small"
                />
              }
              label="读取 (r)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionBits.groupWrite}
                  onChange={handlePermissionChange("groupWrite")}
                  size="small"
                />
              }
              label="写入 (w)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionBits.groupExecute}
                  onChange={handlePermissionChange("groupExecute")}
                  size="small"
                />
              }
              label="执行 (x)"
            />
          </FormGroup>
        </Grid>

        <Grid item xs={4}>
          <Typography variant="subtitle2" align="center" sx={{ mb: 1 }}>
            其他 (Other)
          </Typography>
          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionBits.otherRead}
                  onChange={handlePermissionChange("otherRead")}
                  size="small"
                />
              }
              label="读取 (r)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionBits.otherWrite}
                  onChange={handlePermissionChange("otherWrite")}
                  size="small"
                />
              }
              label="写入 (w)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionBits.otherExecute}
                  onChange={handlePermissionChange("otherExecute")}
                  size="small"
                />
              }
              label="执行 (x)"
            />
          </FormGroup>
        </Grid>
      </Grid>

      <Divider sx={{ my: 2 }} />

      {/* 权限说明 */}
      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          权限说明:
        </Typography>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Typography variant="caption">所有者: {description.owner}</Typography>
          <Typography variant="caption">组: {description.group}</Typography>
          <Typography variant="caption">其他: {description.other}</Typography>
        </Box>

        {octalValue.length === 3 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            当前权限: {octalValue} ({description.owner} / {description.group} /{" "}
            {description.other})
          </Alert>
        )}
      </Box>
    </Box>
  );
};

export default FilePermissionEditor;
