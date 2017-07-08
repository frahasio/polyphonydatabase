class ChangeSourceDates < ActiveRecord::Migration[5.0]
  def change
    remove_column :sources, :date_range
    add_column :sources, :from_year, :integer
    add_column :sources, :to_year, :integer
    add_column :sources, :from_year_annotation, :string
    add_column :sources, :to_year_annotation, :string
  end
end
