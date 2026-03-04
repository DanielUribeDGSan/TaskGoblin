#[link(name = "AddressBook", kind = "framework")]
extern "C" {
    fn ABAddressBookGetAuthorizationStatus() -> isize;
}

fn main() {
    let status = unsafe { ABAddressBookGetAuthorizationStatus() };
    println!("Contacts status: {}", status);
}
