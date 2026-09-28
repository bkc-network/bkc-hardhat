// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice An immutable makes the runtime bytecode unique per deployment, so verifying this
/// is a real verification rather than a bytecode match against something verified earlier.
contract Tagged {
    bytes32 public immutable tag;

    constructor(bytes32 newTag) {
        tag = newTag;
    }
}
