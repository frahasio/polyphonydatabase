class AddSortingToClefCombination < ActiveRecord::Migration[5.0]
  def change
    add_column :clef_combinations, :sorting, :string
  end
end
