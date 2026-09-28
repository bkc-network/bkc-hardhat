// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The smallest contract that proves a write reached the chain and can be read back.
contract Storage {
    uint256 private value;

    event Stored(uint256 value);

    function set(uint256 newValue) external {
        value = newValue;
        emit Stored(newValue);
    }

    function get() external view returns (uint256) {
        return value;
    }
}
