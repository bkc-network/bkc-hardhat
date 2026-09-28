// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Fails on purpose, so the plugin's error path is covered by a test.
contract Reverter {
    error Refused(uint256 value);

    function boom() external pure {
        revert("this one is meant to fail");
    }

    function boomCustom(uint256 value) external pure {
        revert Refused(value);
    }
}
