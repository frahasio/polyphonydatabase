module AdminTestHelpers
  def log_in_admin
    user = create(:user)
    visit admin_authentication_path
    fill_in "Username", with: user.username
    fill_in "Password", with: user.password
    click_on "Log in"
    expect(page).to have_text("Add source")
  end
end
