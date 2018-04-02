class AddPdfTickboxToEdition < ActiveRecord::Migration[5.0]
  def change
    add_column :editions, :has_pdf, :boolean, default: false
  end
end
