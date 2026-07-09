const sendV1Success = (res, { status = 200, data, meta } = {}) => {
  res.status(status).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
};

module.exports = { sendV1Success };
