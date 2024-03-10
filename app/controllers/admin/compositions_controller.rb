class Admin::CompositionsController < Admin::AdminControllerBase
  def index
    @title = Title.find_by(id: params[:title_id])
    @compositions = (@title.present? ? @title.compositions : Composition.none)
  end

  def show
    @composition = Composition.find(params[:id])
  end

  def new
    @composition = Composition.new
  end

  def create
    composition = Composition.create!(composition_params)

    redirect_to admin_compositions_path(title_id: composition.title_id)
  end

  def edit
    @composition = Composition.find(params[:id])
  end

  def update
    composition = Composition.find(params[:id])

    composition.assign_attributes(composition_params)

    if composition.save
      redirect_to admin_compositions_path(title_id: composition.title_id)
    else
      render :edit
    end
  end

  def confirm_delete
    @composition = Composition.find(params[:id])
  end

  def destroy
    composition = Composition.find(params[:id])
    composition.destroy!

    redirect_to admin_compositions_path(title_id: composition.title_id)
  end

  private

  def composition_params
    params.require(:composition).permit(
      :composition_type_id,
      :even_odd,
      :number_of_voices,
      :title_id,
      :tone,
      composer_ids: [],
    )
  end
end
