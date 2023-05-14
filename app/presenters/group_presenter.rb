class GroupPresenter
  def initialize(group)
    @group = group
  end

  def functions
    group.functions.uniq.map(&:name).tap do |function_names|
      group.composition_types.distinct.each do |type|
        function_names.unshift("(#{type.name})")
      end
    end.join(", ")
  end

  private

  attr_reader :group
end
