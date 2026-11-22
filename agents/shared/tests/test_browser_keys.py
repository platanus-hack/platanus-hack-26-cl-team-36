import pytest

from shared.browser.keys import InvalidKeyError, is_back_key, translate_key


def test_translate_key_and_back_keys():
    assert translate_key("ctrl+a") == "Control+a"
    assert translate_key("Return") == "Enter"
    assert translate_key("Page_Down") == "PageDown"
    assert is_back_key("alt+Left")
    assert not is_back_key("Left")


def test_empty_key_is_rejected():
    with pytest.raises(InvalidKeyError):
        translate_key(" + ")
