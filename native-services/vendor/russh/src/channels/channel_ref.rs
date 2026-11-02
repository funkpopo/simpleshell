use super::{ChannelSender, WindowSizeRef};

/// A handle to the [`super::Channel`]'s to be able to transmit messages
/// to it and update it's `window_size`.
#[derive(Debug)]
pub struct ChannelRef {
    pub(super) sender: ChannelSender,
    pub(super) window_size: WindowSizeRef,
}

impl ChannelRef {
    pub fn new(sender: ChannelSender) -> Self {
        Self {
            sender,
            window_size: WindowSizeRef::new(0),
        }
    }

    pub(crate) fn window_size(&self) -> &WindowSizeRef {
        &self.window_size
    }
}

impl std::ops::Deref for ChannelRef {
    type Target = ChannelSender;

    fn deref(&self) -> &Self::Target {
        &self.sender
    }
}
